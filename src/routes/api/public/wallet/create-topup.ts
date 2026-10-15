// Customer App: starts a wallet top-up and creates a Razorpay order.
// Caller sends the customer's Supabase JWT (Authorization: Bearer ...). Body: { amount: rupees }.
import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, preflight } from "@/lib/offer-cors";

export const Route = createFileRoute("/api/public/wallet/create-topup")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        const json = (status: number, body: unknown) => Response.json(body, { status, headers: corsHeaders(request) });
        const { userClient, rz, razorpayKeyId } = await import("@/lib/event-offers.server");
        const sb = userClient(request);
        const { data: u } = sb ? await sb.auth.getUser() : { data: { user: null } };
        if (!u.user) return json(401, { ok: false, error: "NOT_AUTHENTICATED" });
        const body = await request.json().catch(() => ({}));
        const amount = Number(body?.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return json(400, { ok: false, error: "BAD_REQUEST" });
        const { data, error } = await sb!.rpc("customer_wallet_start_topup" as never, { _amount: amount } as never);
        if (error) return json(500, { ok: false, error: error.message });
        const res = data as { ok: boolean; id?: string; amount?: number; error?: string };
        if (!res.ok) return json(200, res);
        const paise = Math.round(Number(res.amount) * 100);
        const order = await rz("/orders", { amount: paise, currency: "INR", receipt: `wal_${res.id!.slice(0, 30)}`, notes: { purpose: "wallet_topup", topup_id: res.id! } });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.rpc("system_set_wallet_topup_order" as never, { _id: res.id, _order_id: order.id } as never);
        return json(200, { ok: true, topup_id: res.id, razorpay_order_id: order.id, amount: paise, amount_rupees: res.amount, currency: "INR", key_id: razorpayKeyId() });
      },
    },
  },
});
