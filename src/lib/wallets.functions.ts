import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  roles: Array<"super_admin" | "ops_manager" | "area_partner">,
) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || !roles.includes(data.role)) {
    throw new Error("Forbidden");
  }
  return data.role as "super_admin" | "ops_manager" | "area_partner";
}

// ---------- Types ----------
export type WalletOwner = {
  id: string;
  owner_type: "expert" | "area_partner";
  name: string;
  phone: string;
  balance: number;
};

export type LedgerEntry = {
  id: string;
  amount: number;
  type: "credit" | "debit";
  reason: string;
  created_at: string;
};

export type PayoutBatch = {
  id: string;
  week_start: string;
  week_end: string;
  status: "pending" | "paid";
  total_amount: number;
  created_at: string;
  batch_type: "expert" | "merchant";
};

export type PayoutItem = {
  id: string;
  batch_id: string;
  owner_type: "expert" | "area_partner" | "merchant";
  owner_id: string;
  owner_name: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
  gross_amount: number;
  tds_rate: number;
  tds_amount: number;
  net_amount: number;
  tds_status: string;
  pan_last4: string | null;
};

export type TdsReportRow = {
  owner_type: string;
  owner_id: string;
  owner_name: string;
  pan_last4: string | null;
  gross_total: number;
  tds_total: number;
  net_total: number;
  deposited_total: number;
  items: number;
};


// ---------- Balances / ledger ----------

export const listWalletOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletOwner[]> => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const db = context.supabase;

    const [{ data: experts, error: e1 }, { data: partners, error: e2 }, { data: ledger, error: e3 }] =
      await Promise.all([
        db.from("experts").select("id, name, phone, wallet_balance"),
        db.from("area_partners").select("id, name, phone"),
        db.from("wallet_ledger").select("owner_type, owner_id, type, amount"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);

    const partnerBalances = new Map<string, number>();
    for (const l of ledger ?? []) {
      if (l.owner_type !== "area_partner") continue;
      const delta = l.type === "credit" ? Number(l.amount) : -Number(l.amount);
      partnerBalances.set(l.owner_id, (partnerBalances.get(l.owner_id) ?? 0) + delta);
    }

    const rows: WalletOwner[] = [];
    for (const e of experts ?? []) {
      rows.push({
        id: e.id,
        owner_type: "expert",
        name: e.name,
        phone: e.phone,
        balance: Number(e.wallet_balance ?? 0),
      });
    }
    for (const p of partners ?? []) {
      rows.push({
        id: p.id,
        owner_type: "area_partner",
        name: p.name,
        phone: p.phone,
        balance: Number(partnerBalances.get(p.id) ?? 0),
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  });

export const listOwnerLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { owner_type: "expert" | "area_partner"; owner_id: string }) => {
    if (!input?.owner_id) throw new Error("owner_id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<LedgerEntry[]> => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const { data: rows, error } = await context.supabase
      .from("wallet_ledger")
      .select("id, amount, type, reason, created_at")
      .eq("owner_type", data.owner_type)
      .eq("owner_id", data.owner_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      type: r.type as "credit" | "debit",
      reason: r.reason,
      created_at: r.created_at,
    }));
  });

export const walletAdjust = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      owner_type: "expert" | "area_partner";
      owner_id: string;
      amount: number;
      type: "credit" | "debit";
      reason: string;
    }) => {
      if (!input?.owner_id) throw new Error("owner_id required");
      if (!(input.amount > 0)) throw new Error("Amount must be positive");
      if (!input.reason?.trim()) throw new Error("Reason required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_wallet_adjust", {
      _owner_type: data.owner_type,
      _owner_id: data.owner_id,
      _amount: data.amount,
      _type: data.type,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Payouts ----------

export const listPayoutBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch_type?: "expert" | "merchant" } | undefined) => input ?? {})
  .handler(async ({ data: input, context }): Promise<PayoutBatch[]> => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    let q = context.supabase
      .from("payout_batches")
      .select("id, week_start, week_end, status, total_amount, created_at, batch_type")
      .order("week_start", { ascending: false });
    if (input.batch_type) q = q.eq("batch_type", input.batch_type);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      week_start: r.week_start,
      week_end: r.week_end,
      status: r.status as "pending" | "paid",
      total_amount: Number(r.total_amount ?? 0),
      created_at: r.created_at,
      batch_type: (r.batch_type ?? "expert") as "expert" | "merchant",
    }));
  });


export const listPayoutItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch_id: string }) => {
    if (!input?.batch_id) throw new Error("batch_id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<PayoutItem[]> => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const db = context.supabase;
    const { data: items, error } = await db
      .from("payout_batch_items")
      .select("id, batch_id, owner_type, owner_id, amount, paid, paid_at, gross_amount, tds_rate, tds_amount, net_amount, tds_status, pan_last4")
      .eq("batch_id", data.batch_id)
      .order("owner_type", { ascending: true });
    if (error) throw new Error(error.message);

    const expertIds = items?.filter((i) => i.owner_type === "expert").map((i) => i.owner_id) ?? [];
    const partnerIds =
      items?.filter((i) => i.owner_type === "area_partner").map((i) => i.owner_id) ?? [];
    const merchantIds =
      items?.filter((i) => i.owner_type === "merchant").map((i) => i.owner_id) ?? [];

    const [expertsRes, partnersRes, merchantsRes] = await Promise.all([
      expertIds.length
        ? db.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [], error: null }),
      partnerIds.length
        ? db.from("area_partners").select("id, name").in("id", partnerIds)
        : Promise.resolve({ data: [], error: null }),
      merchantIds.length
        ? db.from("merchants").select("id, store_name, owner_name, phone").in("id", merchantIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (expertsRes.error) throw new Error(expertsRes.error.message);
    if (partnersRes.error) throw new Error(partnersRes.error.message);
    if (merchantsRes.error) throw new Error(merchantsRes.error.message);

    const nameMap = new Map<string, string>();
    for (const e of expertsRes.data ?? []) nameMap.set(`expert:${e.id}`, e.name);
    for (const p of partnersRes.data ?? []) nameMap.set(`area_partner:${p.id}`, p.name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const m of (merchantsRes.data ?? []) as any[])
      nameMap.set(`merchant:${m.id}`, m.store_name || m.owner_name || m.phone);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((items ?? []) as any[]).map((r) => ({
      id: r.id,
      batch_id: r.batch_id,
      owner_type: r.owner_type as "expert" | "area_partner" | "merchant",
      owner_id: r.owner_id,
      owner_name: nameMap.get(`${r.owner_type}:${r.owner_id}`) ?? "Unknown",
      amount: Number(r.amount ?? 0),
      paid: r.paid,
      paid_at: r.paid_at,
      gross_amount: Number(r.gross_amount ?? r.amount ?? 0),
      tds_rate: Number(r.tds_rate ?? 0),
      tds_amount: Number(r.tds_amount ?? 0),
      net_amount: Number(r.net_amount ?? r.amount ?? 0),
      tds_status: (r.tds_status ?? "none") as string,
      pan_last4: r.pan_last4 ?? null,
    }));
  });

export const generatePayoutBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("staff_generate_payout_batch");
    if (error) throw new Error(error.message);
    return { batchId: data as string };
  });

export const generateMerchantPayoutBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("staff_generate_merchant_payout_batch");
    if (error) throw new Error(error.message);
    return { batchId: data as string };
  });


export const markPayoutItemPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { item_id: string; paid: boolean }) => {
    if (!input?.item_id) throw new Error("item_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_mark_payout_item_paid", {
      _item_id: data.item_id,
      _paid: data.paid,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markPayoutBatchPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch_id: string }) => {
    if (!input?.batch_id) throw new Error("batch_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_confirm_payout_batch", {
      _batch_id: data.batch_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const discardPayoutBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batch_id: string; reason: string }) => {
    if (!input?.batch_id) throw new Error("batch_id required");
    if (!input.reason?.trim()) throw new Error("Reason required");
    return input;
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_discard_payout_batch", {
      _batch_id: data.batch_id,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTdsReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fy_start_year: number }) => {
    if (!input?.fy_start_year) throw new Error("fy_start_year required");
    return input;
  })
  .handler(async ({ data, context }): Promise<TdsReportRow[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (context.supabase as any).rpc("staff_tds_report", {
      _fy_start_year: data.fy_start_year,
    });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((rows ?? []) as any[]).map((r) => ({
      owner_type: r.owner_type,
      owner_id: r.owner_id,
      owner_name: r.owner_name,
      pan_last4: r.pan_last4 ?? null,
      gross_total: Number(r.gross_total ?? 0),
      tds_total: Number(r.tds_total ?? 0),
      net_total: Number(r.net_total ?? 0),
      deposited_total: Number(r.deposited_total ?? 0),
      items: Number(r.items ?? 0),
    }));
  });

export const markTdsDeposited = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { owner_type: string; owner_id: string; fy_start_year: number }) => {
    if (!input?.owner_id) throw new Error("owner_id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ items: number }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: n, error } = await (context.supabase as any).rpc("staff_mark_tds_deposited", {
      _owner_type: data.owner_type,
      _owner_id: data.owner_id,
      _fy_start_year: data.fy_start_year,
    });
    if (error) throw new Error(error.message);
    return { items: Number(n ?? 0) };
  });

// ---------- TDS settings (single toggle + single rate) ----------

export type TdsSettings = { enabled: boolean; rate: number };

export const getTdsSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TdsSettings> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (context.supabase as any)
      .from("ops_settings")
      .select("key, value")
      .in("key", ["tds_master_enabled", "tds_default_rate"]);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new Map(((data ?? []) as any[]).map((r) => [r.key, String(r.value ?? "")]));
    return {
      enabled: map.get("tds_master_enabled") === "1",
      rate: Number(map.get("tds_default_rate") ?? 2) || 0,
    };
  });

export const saveTdsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled?: boolean; rate?: number }) => {
    if (input?.rate !== undefined) {
      if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100)
        throw new Error("TDS rate must be between 0 and 100");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    if (data.enabled !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (context.supabase as any).rpc("staff_set_ops_setting", {
        _key: "tds_master_enabled",
        _value: data.enabled ? "1" : "0",
      });
      if (error) throw new Error(error.message);
    }
    if (data.rate !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (context.supabase as any).rpc("staff_set_ops_setting", {
        _key: "tds_default_rate",
        _value: String(data.rate),
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
