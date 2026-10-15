import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const chk = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

export type ExpenseRow = {
  id: string; expense_date: string; category: string; amount: number; gst_paid: number;
  paid_via: string; vendor: string | null; note: string | null; subscription_id: string | null;
};
export type SubscriptionRow = {
  id: string; name: string; vendor: string | null; amount: number; billing_cycle: "monthly" | "yearly";
  next_due_date: string; auto_renew: boolean; payment_method_label: string | null; category: string; status: string;
};

export const getFinanceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { from: string; to: string }) => ({ from: String(i.from).slice(0, 10), to: String(i.to).slice(0, 10) }))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any).rpc("fin_overview", { _from: data.from, _to: data.to }); chk(r);
    return r.data as Record<string, any>;
  });

export const listExpenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { month: string }) => ({ month: String(i.month).slice(0, 7) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const [y, m] = data.month.split("-").map(Number);
    const from = `${data.month}-01`;
    const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const r = await db.from("operating_expenses").select("*").gte("expense_date", from).lt("expense_date", to).order("expense_date", { ascending: false }).limit(1000);
    chk(r);
    const c = await db.from("expense_categories").select("name, is_active").order("sort_order"); chk(c);
    return { rows: (r.data ?? []) as ExpenseRow[], categories: (c.data ?? []) as { name: string; is_active: boolean }[] };
  });

export const saveExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id?: string | null; p: Record<string, unknown> }) => i)
  .handler(async ({ data, context }) => {
    chk(await (context.supabase as any).rpc("fin_save_expense", { _id: data.id ?? null, _p: data.p })); return { ok: true };
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    chk(await (context.supabase as any).rpc("fin_delete_expense", { _id: data.id })); return { ok: true };
  });

export const saveExpenseCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { name: string; active: boolean }) => i)
  .handler(async ({ data, context }) => {
    chk(await (context.supabase as any).rpc("fin_save_expense_category", { _name: data.name, _active: data.active })); return { ok: true };
  });

export const listSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await (context.supabase as any).from("vendor_subscriptions").select("*").order("next_due_date"); chk(r);
    return (r.data ?? []) as SubscriptionRow[];
  });

export const saveSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id?: string | null; p: Record<string, unknown> }) => i)
  .handler(async ({ data, context }) => {
    chk(await (context.supabase as any).rpc("fin_save_subscription", { _id: data.id ?? null, _p: data.p })); return { ok: true };
  });

export const markSubscriptionPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; paidVia: string }) => i)
  .handler(async ({ data, context }) => {
    chk(await (context.supabase as any).rpc("fin_mark_subscription_paid", { _id: data.id, _paid_via: data.paidVia })); return { ok: true };
  });

export const getInstantFeePct = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await (context.supabase as any).from("ops_settings").select("value").eq("key", "instant_settlement_fee_pct").maybeSingle(); chk(r);
    return Number(r.data?.value ?? 1);
  });

export const setInstantFeePct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { pct: number }) => ({ pct: Number(i.pct) }))
  .handler(async ({ data, context }) => {
    chk(await (context.supabase as any).rpc("fin_set_instant_fee_pct", { _pct: data.pct })); return { ok: true };
  });
