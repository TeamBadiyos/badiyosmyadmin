import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireSuperAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || data.role !== "super_admin") {
    throw new Error("Forbidden");
  }
}

export type ReferralConfig = {
  id: string | null;
  reward_coins: number;
  is_active: boolean;
};

export type ReferralRow = {
  id: string;
  status: string;
  reward_amount: number;
  reward_date: string | null;
  booking_id: string | null;
  created_at: string | null;
  reversal_reason: string | null;
  referrer_name: string | null;
  referrer_phone: string | null;
  referred_name: string | null;
  referred_phone: string | null;
};

export const getReferralConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReferralConfig> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("referral_config")
      .select("id, reward_coins, is_active, updated_at")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      id: data?.id ?? null,
      reward_coins: Number(data?.reward_coins ?? 50),
      is_active: data?.is_active ?? true,
    };
  });

export const updateReferralConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reward_coins: number; is_active: boolean }) => {
    if (!(input.reward_coins >= 0)) throw new Error("Reward must be non-negative");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_referral_config", {
      _reward: data.reward_coins,
      _is_active: data.is_active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<ReferralRow[]> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("referral_transactions")
      .select(
        "id, status, reward_amount, reward_date, booking_id, created_at, reversal_reason, referrer_id, referred_user_id",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data?.status) q = q.eq("status", data.status);
    const { data: txns, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = new Set<string>();
    for (const t of txns ?? []) {
      if (t.referrer_id) userIds.add(t.referrer_id);
      if (t.referred_user_id) userIds.add(t.referred_user_id);
    }
    const { data: users, error: uErr } = userIds.size
      ? await supabaseAdmin.from("users").select("id, full_name, phone").in("id", Array.from(userIds))
      : { data: [], error: null };
    if (uErr) throw new Error(uErr.message);
    const uMap = new Map<string, { name: string | null; phone: string | null }>();
    for (const u of users ?? [])
      uMap.set(u.id, { name: u.full_name ?? null, phone: u.phone ?? null });

    return (txns ?? []).map((t) => {
      const ref = t.referrer_id ? uMap.get(t.referrer_id) : null;
      const to = t.referred_user_id ? uMap.get(t.referred_user_id) : null;
      return {
        id: t.id,
        status: t.status,
        reward_amount: Number(t.reward_amount ?? 0),
        reward_date: t.reward_date,
        booking_id: t.booking_id,
        created_at: t.created_at,
        reversal_reason: t.reversal_reason ?? null,
        referrer_name: ref?.name ?? null,
        referrer_phone: ref?.phone ?? null,
        referred_name: to?.name ?? null,
        referred_phone: to?.phone ?? null,
      };
    });
  });

export const listReferralStatuses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("referral_transactions")
      .select("status")
      .limit(1000);
    if (error) throw new Error(error.message);
    const set = new Set<string>();
    for (const r of data ?? []) if (r.status) set.add(r.status);
    // ensure common ones always show up
    ["pending", "registered", "reward_credited", "reversed"].forEach((s) => set.add(s));
    return Array.from(set).sort();
  });

export const reverseReferralReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { txn_id: string; reason: string }) => {
    if (!input?.txn_id) throw new Error("txn_id required");
    if (!input.reason?.trim()) throw new Error("Reason required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_reverse_referral_reward", {
      _txn_id: data.txn_id,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
