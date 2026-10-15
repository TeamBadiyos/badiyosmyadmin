// Customer App: verifies the Razorpay checkout signature, confirms the payment
// with Razorpay, then credits the wallet (+ any bonus). Idempotent.
import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, preflight } from "@/lib/offer-cors";

export const Route = createFileRoute("/api/public/wallet/verify-topup")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        const json = (status: number, body: unknown) => Response.json(body, { status, headers: corsHeaders(request) });
        const { userClient, verifyCheckoutSignature, rz } = await import("@/lib/event-offers.server");
        const sb = userClient(request);
        const { data: u } = sb ? await sb.auth.getUser() : { data: { user: null } };
        if (!u.user) return json(401, { ok: false, error: "NOT_AUTHENTICATED" });
        const b = await request.json().catch(() => ({}));
        const orderId = b?.razorpay_order_id, paymentId = b?.razorpay_payment_id, sig = b?.razorpay_signature;
        if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof sig !== "string") return json(400, { ok: false, error: "BAD_REQUEST" });
        if (!(await verifyCheckoutSignature(orderId, paymentId, sig))) return json(400, { ok: false, error: "BAD_SIGNATURE" });
        const { data: own } = await sb!.from("wallet_topups" as never).select("id").eq("razorpay_order_id", orderId).maybeSingle();
        if (!own) return json(404, { ok: false, error: "NOT_FOUND" });
        const pay = await rz(`/payments/${paymentId}`);
        if (pay.order_id !== orderId || !["captured", "authorized"].includes(pay.status)) return json(200, { ok: false, error: "PAYMENT_NOT_CAPTURED" });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("system_confirm_wallet_topup" as never, { _razorpay_order_id: orderId, _payment_id: paymentId, _amount_paise: pay.amount } as never);
        if (error) return json(500, { ok: false, error: error.message });
        return json(200, data);
      },
    },
  },
});
