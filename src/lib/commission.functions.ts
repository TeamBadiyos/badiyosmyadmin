import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CommissionType = "per_hour" | "fixed" | "percent";

export type CommissionAccess = {
  role: "super_admin" | "ops_manager";
  canWrite: boolean;
  newEngineEnabled: boolean;
};

export type CommissionRuleRow = {
  rule_id: string | null;
  scope: "default" | "price_option";
  price_option_id: string | null;
  product_label: string;
  service_name: string;
  customer_price: number;
  duration_minutes: number | null;
  expert_type: CommissionType;
  expert_value: number;
  partner_type: CommissionType;
  partner_value: number;
  min_hq_share: number;
  is_active: boolean;
  expert_amount: number;
  partner_amount: number;
  hq_amount: number;
};

export type ParityRow = {
  label: string;
  customer_price: number;
  legacy_expert: number;
  legacy_partner: number;
  new_expert: number;
  new_partner: number;
  matches: boolean;
};

async function requireStaff(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) {
    throw new Error("Forbidden");
  }
  return data.role as "super_admin" | "ops_manager";
}

function requireWriter(role: string) {
  if (role !== "super_admin") throw new Error("Forbidden: super admin only");
}

function computeSplit(
  price: number,
  durationMinutes: number | null,
  expertType: CommissionType,
  expertValue: number,
  partnerType: CommissionType,
  partnerValue: number,
) {
  const hours = Math.max((durationMinutes ?? 60) / 60, 1 / 60);
  const calc = (t: CommissionType, v: number) =>
    t === "per_hour" ? v * hours : t === "percent" ? (price * v) / 100 : v;
  const expert = Math.round(calc(expertType, expertValue));
  const partner = Math.round(calc(partnerType, partnerValue));
  return { expert, partner, hq: Math.round(price) - expert - partner };
}

export const getCommissionAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommissionAccess> => {
    const role = await requireStaff(context.supabase, context.userId);
    const { data } = await (context.supabase as any)
      .from("ops_settings")
      .select("value")
      .eq("key", "use_new_commission_engine")
      .maybeSingle();
    return { role, canWrite: role === "super_admin", newEngineEnabled: data?.value === "1" };
  });

export const listCommissionRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommissionRuleRow[]> => {
    await requireStaff(context.supabase, context.userId);
    const db = context.supabase as any;

    const [{ data: rules, error: e1 }, { data: options, error: e2 }] = await Promise.all([
      db.from("commission_rules").select("*"),
      db
        .from("service_price_options")
        .select("id, label, customer_price, duration_minutes, display_order, service_id, is_active")
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const serviceIds = [...new Set((options ?? []).map((o: any) => o.service_id))].filter(Boolean);
    const { data: services } = serviceIds.length
      ? await db.from("services").select("id, name").in("id", serviceIds)
      : { data: [] };
    const serviceName = new Map<string, string>(
      ((services ?? []) as any[]).map((s) => [s.id, s.name]),
    );

    const byOption = new Map<string, any>();
    let defaultRule: any = null;
    for (const r of (rules ?? []) as any[]) {
      if (r.scope === "default") defaultRule = r;
      else if (r.price_option_id) byOption.set(r.price_option_id, r);
    }

    const rows: CommissionRuleRow[] = [];

    if (defaultRule) {
      const split = computeSplit(
        0,
        60,
        defaultRule.expert_type,
        Number(defaultRule.expert_value),
        defaultRule.partner_type,
        Number(defaultRule.partner_value),
      );
      rows.push({
        rule_id: defaultRule.id,
        scope: "default",
        price_option_id: null,
        product_label: "Default rule (used when no item rule exists)",
        service_name: "—",
        customer_price: 0,
        duration_minutes: 60,
        expert_type: defaultRule.expert_type,
        expert_value: Number(defaultRule.expert_value),
        partner_type: defaultRule.partner_type,
        partner_value: Number(defaultRule.partner_value),
        min_hq_share: Number(defaultRule.min_hq_share ?? 0),
        is_active: defaultRule.is_active,
        expert_amount: split.expert,
        partner_amount: split.partner,
        hq_amount: 0,
      });
    }

    for (const o of (options ?? []) as any[]) {
      const r = byOption.get(o.id) ?? defaultRule;
      const price = Number(o.customer_price ?? 0);
      const split = computeSplit(
        price,
        o.duration_minutes,
        r?.expert_type ?? "fixed",
        Number(r?.expert_value ?? 0),
        r?.partner_type ?? "fixed",
        Number(r?.partner_value ?? 0),
      );
      rows.push({
        rule_id: byOption.has(o.id) ? byOption.get(o.id).id : null,
        scope: "price_option",
        price_option_id: o.id,
        product_label: o.label,
        service_name: serviceName.get(o.service_id) ?? "—",
        customer_price: price,
        duration_minutes: o.duration_minutes,
        expert_type: (r?.expert_type ?? "fixed") as CommissionType,
        expert_value: Number(r?.expert_value ?? 0),
        partner_type: (r?.partner_type ?? "fixed") as CommissionType,
        partner_value: Number(r?.partner_value ?? 0),
        min_hq_share: Number(r?.min_hq_share ?? 0),
        is_active: r?.is_active ?? true,
        expert_amount: split.expert,
        partner_amount: split.partner,
        hq_amount: split.hq,
      });
    }

    return rows;
  });

export const saveCommissionRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string | null;
      scope: "default" | "price_option";
      price_option_id?: string | null;
      expert_type: CommissionType;
      expert_value: number;
      partner_type: CommissionType;
      partner_value: number;
      min_hq_share?: number;
      is_active?: boolean;
      notes?: string | null;
    }) => {
      if (!(input.expert_value >= 0) || !(input.partner_value >= 0)) {
        throw new Error("Values must be non-negative");
      }
      if (input.scope === "price_option" && !input.price_option_id) {
        throw new Error("Product is required");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const role = await requireStaff(context.supabase, context.userId);
    requireWriter(role);
    const { data: id, error } = await (context.supabase as any).rpc(
      "staff_upsert_commission_rule",
      {
        _id: data.id ?? null,
        _scope: data.scope,
        _price_option_id: data.price_option_id ?? null,
        _expert_type: data.expert_type,
        _expert_value: data.expert_value,
        _partner_type: data.partner_type,
        _partner_value: data.partner_value,
        _min_hq_share: data.min_hq_share ?? 0,
        _is_active: data.is_active ?? true,
        _notes: data.notes ?? null,
      },
    );
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const bulkSaveCommissionRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      price_option_ids: string[];
      expert_type: CommissionType;
      expert_value: number;
      partner_type: CommissionType;
      partner_value: number;
    }) => {
      if (!input.price_option_ids?.length) throw new Error("Select at least one product");
      if (!(input.expert_value >= 0) || !(input.partner_value >= 0)) {
        throw new Error("Values must be non-negative");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const role = await requireStaff(context.supabase, context.userId);
    requireWriter(role);
    const db = context.supabase as any;
    const { data: existing } = await db
      .from("commission_rules")
      .select("id, price_option_id")
      .in("price_option_id", data.price_option_ids);
    const idByOption = new Map<string, string>(
      ((existing ?? []) as any[]).map((r) => [r.price_option_id, r.id]),
    );

    for (const optionId of data.price_option_ids) {
      const { error } = await db.rpc("staff_upsert_commission_rule", {
        _id: idByOption.get(optionId) ?? null,
        _scope: "price_option",
        _price_option_id: optionId,
        _expert_type: data.expert_type,
        _expert_value: data.expert_value,
        _partner_type: data.partner_type,
        _partner_value: data.partner_value,
        _min_hq_share: 0,
        _is_active: true,
        _notes: "Bulk update",
      });
      if (error) throw new Error(error.message);
    }
    return { updated: data.price_option_ids.length };
  });

export const setCommissionRuleActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const role = await requireStaff(context.supabase, context.userId);
    requireWriter(role);
    const { error } = await (context.supabase as any).rpc("staff_set_commission_rule_active", {
      _id: data.id,
      _is_active: data.is_active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const verifyCommissionParity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ParityRow[]> => {
    await requireStaff(context.supabase, context.userId);
    const { data, error } = await (context.supabase as any).rpc("verify_commission_parity");
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((r) => ({
      label: r.label,
      customer_price: Number(r.customer_price ?? 0),
      legacy_expert: Number(r.legacy_expert ?? 0),
      legacy_partner: Number(r.legacy_partner ?? 0),
      new_expert: Number(r.new_expert ?? 0),
      new_partner: Number(r.new_partner ?? 0),
      matches: !!r.matches,
    }));
  });

// ---------- Finance settings (commission engine + TDS) ----------

export type FinanceSetting = { key: string; value: string; label: string | null };

export const listFinanceSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinanceSetting[]> => {
    await requireStaff(context.supabase, context.userId);
    const { data, error } = await (context.supabase as any)
      .from("ops_settings")
      .select("key, value, label")
      .or(
        "key.eq.use_new_commission_engine,key.eq.payout_batch_wallet_mode,key.like.tds_%,key.eq.commission_min_hq_share,key.eq.reward_punctuality_gate_enabled",
      )
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as FinanceSetting[];
  });

export const setFinanceSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string; value: string }) => {
    if (!input?.key) throw new Error("key required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const role = await requireStaff(context.supabase, context.userId);
    requireWriter(role);
    const { error } = await (context.supabase as any).rpc("staff_set_ops_setting", {
      _key: data.key,
      _value: data.value,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
