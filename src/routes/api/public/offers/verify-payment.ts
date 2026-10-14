// verify-offer-payment: checks the Razorpay checkout signature, confirms the
// payment with Razorpay, then marks the redemption paid (idempotent).
import { createFileRoute } from "@tanstack/react-router";
import { corsHeaders, preflight } from "@/lib/offer-cors";

export const Route = createFileRoute("/api/public/offers/verify-payment")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) => {
        const json = (status: number, body: unknown) => Response.json(body, { status, headers: corsHeaders(request) });
        const { userClient, verifyCheckoutSignature, markOfferPaid } = await import("@/lib/event-offers.server");
        const sb = userClient(request);
        const { data: u } = sb ? await sb.auth.getUser() : { data: { user: null } };
        if (!u.user) return json(401, { ok: false, error: "NOT_AUTHENTICATED" });
        const b = await request.json().catch(() => ({}));
        const orderId = b?.razorpay_order_id, paymentId = b?.razorpay_payment_id, sig = b?.razorpay_signature;
        if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof sig !== "string") {
          return json(400, { ok: false, error: "BAD_REQUEST" });
        }
        if (!(await verifyCheckoutSignature(orderId, paymentId, sig))) return json(400, { ok: false, error: "BAD_SIGNATURE" });
        // Only the caller's own order can be verified here.
        const { data: own } = await sb!.from("event_redemptions" as never).select("id").eq("razorpay_order_id", orderId).maybeSingle();
        if (!own) return json(404, { ok: false, error: "NOT_FOUND" });
        return json(200, await markOfferPaid(orderId, paymentId));
      },
    },
  },
});
