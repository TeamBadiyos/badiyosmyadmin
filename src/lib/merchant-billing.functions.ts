import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FeeTier = {
  id: string;
  name: string;
  monthlyFee: number;
  isActive: boolean;
};

export type BillableMerchant = {
  id: string;
  storeName: string | null;
  ownerName: string | null;
  phone: string;
  city: string | null;
  feeTierId: string | null;
};

export type SubscriptionInvoice = {
  id: string;
  merchantId: string;
  merchantName: string | null;
  feeTierName: string | null;
  billingMonth: string;
  amount: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

export const listFeeTiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FeeTier[]> => {
    const { data, error } = await context.supabase
      .from("merchant_fee_tiers")
      .select("id, name, monthly_fee, is_active")
      .order("monthly_fee", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      monthlyFee: Number(t.monthly_fee),
      isActive: t.is_active,
    }));
  });

export const upsertFeeTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id?: string | null; name?: string; monthlyFee?: number; isActive?: boolean }) => input,
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const payload: Record<string, string | number | boolean> = {};
    if (data.id) payload["id"] = data.id;
    if (data.name !== undefined) payload["name"] = data.name;
    if (data.monthlyFee !== undefined) payload["monthly_fee"] = data.monthlyFee;
    if (data.isActive !== undefined) payload["is_active"] = data.isActive;
    const { data: id, error } = await context.supabase.rpc("staff_upsert_fee_tier", {
      _payload: payload,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const listBillableMerchants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillableMerchant[]> => {
    const { data, error } = await context.supabase
      .from("merchants")
      .select("id, store_name, owner_name, phone, city, fee_tier_id, status")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      id: m.id,
      storeName: m.store_name,
      ownerName: m.owner_name,
      phone: m.phone,
      city: m.city,
      feeTierId: m.fee_tier_id,
    }));
  });

export const setMerchantFeeTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { merchantId: string; feeTierId: string | null }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_set_merchant_fee_tier", {
      _merchant_id: data.merchantId,
      _fee_tier_id: data.feeTierId as string,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateSubscriptionInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ billingMonth: string; created: number }> => {
    const { data, error } = await context.supabase.rpc("staff_generate_subscription_invoices");
    if (error) throw new Error(error.message);
    const r = (data ?? {}) as { billing_month?: string; created?: number };
    return { billingMonth: r.billing_month ?? "", created: r.created ?? 0 };
  });

export const listSubscriptionInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string | null; month?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<SubscriptionInvoice[]> => {
    let q = context.supabase
      .from("merchant_subscription_invoices")
      .select("id, merchant_id, fee_tier_id, billing_month, amount, status, paid_at, created_at")
      .order("billing_month", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);
    if (data.month) q = q.eq("billing_month", data.month);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    if (!list.length) return [];

    const merchantIds = Array.from(new Set(list.map((r) => r.merchant_id)));
    const tierIds = Array.from(new Set(list.map((r) => r.fee_tier_id).filter(Boolean) as string[]));
    const [{ data: merchants }, { data: tiers }] = await Promise.all([
      context.supabase.from("merchants").select("id, store_name, phone").in("id", merchantIds),
      tierIds.length
        ? context.supabase.from("merchant_fee_tiers").select("id, name").in("id", tierIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const mMap = new Map(
      ((merchants ?? []) as { id: string; store_name: string | null; phone: string }[]).map((m) => [
        m.id,
        m.store_name || m.phone,
      ]),
    );
    const tMap = new Map(((tiers ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

    return list.map((r) => ({
      id: r.id,
      merchantId: r.merchant_id,
      merchantName: mMap.get(r.merchant_id) ?? null,
      feeTierName: r.fee_tier_id ? (tMap.get(r.fee_tier_id) ?? null) : null,
      billingMonth: r.billing_month,
      amount: Number(r.amount),
      status: r.status,
      paidAt: r.paid_at,
      createdAt: r.created_at,
    }));
  });

export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { invoiceId: string; paid: boolean }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_mark_subscription_invoice_paid", {
      _invoice_id: data.invoiceId,
      _paid: data.paid,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Commission-based billing ----------

export type CommissionMerchant = {
  id: string;
  storeName: string | null;
  ownerName: string | null;
  phone: string;
  city: string | null;
  commissionPct: number;
  bankReady: boolean;
  orders: number;
  gross: number;
  commission: number;
  commissionGst: number;
  merchantNet: number;
};

export type CommissionDeduction = {
  id: string;
  orderNumber: string;
  merchantId: string;
  merchantName: string | null;
  createdAt: string;
  itemsTotal: number;
  commissionPct: number;
  commission: number;
  commissionGst: number;
  merchantNet: number;
};

export type CommissionBilling = {
  merchants: CommissionMerchant[];
  deductions: CommissionDeduction[];
};

export const listMerchantCommissionBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<CommissionBilling> => {
    const db = context.supabase;
    const { data: ms, error } = await db
      .from("merchants")
      .select(
        "id, store_name, owner_name, phone, city, commission_value, bank_account_number, bank_ifsc, deleted_at",
      )
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    let q = db
      .from("merchant_orders")
      .select(
        "id, order_number, merchant_id, created_at, items_total, commission_pct, commission_amount, commission_gst_amount, merchant_net",
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (data.month) {
      const start = new Date(`${data.month}-01T00:00:00+05:30`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      q = q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    }
    const { data: orders, error: oErr } = await q;
    if (oErr) throw new Error(oErr.message);

    const nameMap = new Map<string, string | null>();
    const agg = new Map<string, { orders: number; gross: number; c: number; g: number; net: number }>();
    for (const m of ms ?? []) nameMap.set(m.id, m.store_name || m.phone);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deductions: CommissionDeduction[] = ((orders ?? []) as any[]).map((o) => {
      const a = agg.get(o.merchant_id) ?? { orders: 0, gross: 0, c: 0, g: 0, net: 0 };
      a.orders += 1;
      a.gross += Number(o.items_total ?? 0);
      a.c += Number(o.commission_amount ?? 0);
      a.g += Number(o.commission_gst_amount ?? 0);
      a.net += Number(o.merchant_net ?? 0);
      agg.set(o.merchant_id, a);
      return {
        id: o.id,
        orderNumber: o.order_number ?? "",
        merchantId: o.merchant_id,
        merchantName: nameMap.get(o.merchant_id) ?? null,
        createdAt: o.created_at,
        itemsTotal: Number(o.items_total ?? 0),
        commissionPct: Number(o.commission_pct ?? 0),
        commission: Number(o.commission_amount ?? 0),
        commissionGst: Number(o.commission_gst_amount ?? 0),
        merchantNet: Number(o.merchant_net ?? 0),
      };
    });

    return {
      merchants: (ms ?? []).map((m) => {
        const a = agg.get(m.id) ?? { orders: 0, gross: 0, c: 0, g: 0, net: 0 };
        return {
          id: m.id,
          storeName: m.store_name,
          ownerName: m.owner_name,
          phone: m.phone,
          city: m.city,
          commissionPct: Number(m.commission_value ?? 0),
          bankReady: !!(m.bank_account_number && m.bank_ifsc),
          orders: a.orders,
          gross: a.gross,
          commission: a.c,
          commissionGst: a.g,
          merchantNet: a.net,
        };
      }),
      deductions,
    };
  });
