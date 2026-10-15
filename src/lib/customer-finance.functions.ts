import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const rpc = async (db: any, fn: string, args: Record<string, unknown>) => {
  const r = await db.rpc(fn, args);
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export type InvoiceLine = { desc: string; sac: string; taxable: number; gst_pct: number; gst: number };
export type CustomerInvoice = {
  id: string; invoice_no: string; invoice_date: string; customer_name: string | null; customer_phone: string | null;
  service: string; ref_type: string; ref_code: string | null; lines: InvoiceLine[]; discount: number;
  taxable_value: number; cgst: number; sgst: number; igst: number; total: number; company: Record<string, string>;
  merchant_goods?: { merchant_name: string | null; merchant_gstin: string | null; items: { desc: string; qty: number; amount: number }[]; total: number } | null;
};
export type CreditNote = {
  id: string; credit_note_no: string; note_date: string; invoice_no: string; customer_name: string | null;
  service: string; ref_code: string | null; reason: string | null; taxable_value: number; cgst: number; sgst: number; igst: number; total: number;
};

export const listCustomerInvoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { from: string; to: string; service?: string | null; q?: string | null }) => ({
    from: String(i.from).slice(0, 10), to: String(i.to).slice(0, 10),
    service: i.service ? String(i.service).slice(0, 20) : null, q: i.q ? String(i.q).slice(0, 60) : null,
  }))
  .handler(async ({ data, context }) =>
    (await rpc(context.supabase, "staff_list_customer_invoices", { _from: data.from, _to: data.to, _service: data.service, _q: data.q })) as {
      invoices: CustomerInvoice[]; credit_notes: CreditNote[]; visible: boolean;
    });

export const setFinanceFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { key: "customer_invoices_visible" | "customer_wallet_enabled"; value: boolean }) => ({ key: i.key, value: !!i.value }))
  .handler(async ({ data, context }) => { await rpc(context.supabase, "staff_set_finance_flag", { _key: data.key, _value: data.value }); return { ok: true }; });

export type WalletRow = { user_id: string; name: string | null; phone: string | null; cash: number; bonus: number; updated_at: string };
export type BonusRule = {
  id: string; name: string; min_topup: number; bonus_type: "flat" | "percent"; bonus_value: number; max_bonus: number | null;
  validity_days: number; starts_at: string | null; ends_at: string | null; is_active: boolean;
};
export type LedgerRow = { id: string; type: string; bucket: string; amount: number; cash_after: number; bonus_after: number; reason: string | null; ref_type: string | null; ref_id: string | null; expires_at: string | null; created_at: string };

export const getWalletOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { q?: string | null }) => ({ q: i.q ? String(i.q).slice(0, 60) : null }))
  .handler(async ({ data, context }) =>
    (await rpc(context.supabase, "staff_wallet_overview", { _q: data.q })) as {
      enabled: boolean; totals: { cash: number; bonus: number; wallets: number }; wallets: WalletRow[]; rules: BonusRule[];
    });

export const getWalletLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string }) => ({ userId: String(i.userId) }))
  .handler(async ({ data, context }) => (await rpc(context.supabase, "staff_wallet_ledger", { _user_id: data.userId })) as LedgerRow[]);

export const findCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { phone: string }) => ({ phone: String(i.phone).replace(/\D/g, "").slice(0, 12) }))
  .handler(async ({ data, context }) => (await rpc(context.supabase, "staff_find_customer", { _phone: data.phone })) as { user_id: string; name: string | null; phone: string | null }[]);

export const adjustWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string; bucket: "cash" | "bonus"; amount: number; reason: string }) => ({
    userId: String(i.userId), bucket: i.bucket === "bonus" ? "bonus" : "cash", amount: Number(i.amount), reason: String(i.reason).slice(0, 300),
  }))
  .handler(async ({ data, context }) =>
    rpc(context.supabase, "staff_wallet_adjust", { _user_id: data.userId, _bucket: data.bucket, _amount: data.amount, _reason: data.reason }));

export const saveBonusRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id?: string | null; p: Record<string, unknown> }) => ({ id: i.id ?? null, p: i.p }))
  .handler(async ({ data, context }) => rpc(context.supabase, "staff_save_wallet_bonus_rule", { _id: data.id, _p: data.p }));
