import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireFinance(supabase: { rpc: (n: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("is_offer_finance_user" as never);
  if (!data) throw new Error("Only super admin or finance can refund");
}

/** Refund a single paid event-offer redemption (super_admin / finance). */
export const refundOfferRedemption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { redemptionId: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase as never);
    const { refundRedemption } = await import("@/lib/event-offers.server");
    return refundRedemption(data.redemptionId);
  });

/** process_offer_refunds: refund every still-'paid' row of an ended auto_refund offer. */
export const processOfferRefunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offerId: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase as never);
    const { data: rows, error } = await context.supabase.rpc("staff_offer_refundable" as never, { _offer_id: data.offerId } as never);
    if (error) throw new Error(error.message);
    const { refundRedemption } = await import("@/lib/event-offers.server");
    let refunded = 0; const failed: string[] = [];
    for (const r of (rows ?? []) as Array<{ id: string }>) {
      try { const res = await refundRedemption(r.id); if (res.ok) refunded++; else failed.push(r.id); }
      catch { failed.push(r.id); }
    }
    return { refunded, failed };
  });
