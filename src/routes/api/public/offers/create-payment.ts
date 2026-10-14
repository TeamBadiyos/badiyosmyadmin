// create-offer-payment: holds one unit of stock and creates a Razorpay order.
// Caller must send the customer's Supabase JWT (Authorization: Bearer ...).
import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, preflight } from "@/lib/offer-cors";

export const Route = createFileRoute("/api/public/offers/create-payment")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        const json = (status: number, body: unknown) => Response.json(body, { status, headers: corsHeaders(request) });
        const { userClient, rz, razorpayKeyId } = await import("@/lib/event-offers.server");
        const sb = userClient(request);
        if (!sb) return json(401, { ok: false, error: "NOT_AUTHENTICATED" });
        const { data: u } = await sb.auth.getUser();
        if (!u.user) return json(401, { ok: false, error: "NOT_AUTHENTICATED" });
        const body = await request.json().catch(() => ({}));
        if (typeof body?.offer_id !== "string") return json(400, { ok: false, error: "BAD_REQUEST" });

        const { data, error } = await sb.rpc("start_offer_payment" as never, {
          p_offer_id: body.offer_id, p_device_key: typeof body.device_key === "string" ? body.device_key : null,
        } as never);
        if (error) return json(500, { ok: false, error: error.message });
        const res = data as { ok: boolean; error?: string; id?: string; amount?: number; already_paid?: boolean; razorpay_order_id?: string | null };
        if (!res.ok || res.already_paid) return json(200, res);

        let orderId = res.razorpay_order_id ?? null;
        if (!orderId) {
          const order = await rz("/orders", {
            amount: res.amount, currency: "INR", receipt: `evt_${res.id!.slice(0, 30)}`,
            notes: { purpose: "event_offer", redemption_id: res.id!, offer_id: body.offer_id },
          });
          orderId = order.id as string;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("system_set_offer_order" as never, { _redemption_id: res.id, _order_id: orderId } as never);
        }
        return json(200, { ok: true, redemption_id: res.id, razorpay_order_id: orderId, amount: res.amount, currency: "INR", key_id: razorpayKeyId() });
      },
    },
  },
});
