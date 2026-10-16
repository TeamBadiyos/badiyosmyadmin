import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
const call = async (db: any, fn: string, args?: Record<string, unknown>) => {
  const r = await db.rpc(fn, args ?? {});
  if (r.error) throw new Error(r.error.message);
  return r.data as any;
};

export type MerchantReferralConfig = { reward_amount: number; target_orders: number; window_days: number; is_active: boolean; updated_at: string };
export type MerchantReferralRow = {
  id: string; status: string; reward_amount: number; target_orders: number; window_days: number;
  live_at: string | null; window_expires_at: string | null; delivered_count: number;
  earned_at: string | null; earned_by: string | null; reversed_at: string | null; reversal_reason: string | null;
  referrer_name: string | null; referrer_phone: string | null; referred_name: string | null; referred_phone: string | null;
  created_at: string;
};

export const listMerchantReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const d = await call(context.supabase, "staff_merchant_referrals");
    return { config: d?.config as MerchantReferralConfig, rows: (d?.rows ?? []) as MerchantReferralRow[] };
  });

export const saveMerchantReferralConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { reward: number; target: number; days: number; active: boolean }) => ({
    reward: Number(i.reward), target: Math.round(Number(i.target)), days: Math.round(Number(i.days)), active: !!i.active,
  }))
  .handler(async ({ data, context }) => {
    await call(context.supabase, "staff_update_merchant_referral_config", { _reward: data.reward, _target: data.target, _days: data.days, _active: data.active });
    return { ok: true };
  });

export const markMerchantReferralEarned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    await call(context.supabase, "staff_mark_merchant_referral_earned", { _id: data.id });
    return { ok: true };
  });

export const reverseMerchantReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; reason: string }) => ({ id: String(i.id), reason: String(i.reason ?? "").trim() }))
  .handler(async ({ data, context }) => {
    if (!data.reason) throw new Error("Reason required");
    await call(context.supabase, "staff_reverse_merchant_referral", { _id: data.id, _reason: data.reason });
    return { ok: true };
  });
