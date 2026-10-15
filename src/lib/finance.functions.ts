import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const chk = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };
const rpc = (db: any, fn: string, args: Record<string, unknown>) => db.rpc(fn, args);

export const getDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { from: string; to: string }) => ({ from: String(i.from).slice(0, 10), to: String(i.to).slice(0, 10) }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "staff_dashboard_overview", { _from: data.from, _to: data.to }); chk(r);
    return r.data as any;
  });

export const listMerchantSettlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { status?: string | null; type?: string | null }) => ({ status: i?.status ?? null, type: i?.type ?? null }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    let q = db.from("merchant_settlements").select("*").order("created_at", { ascending: false }).limit(500);
    if (data.status) q = q.eq("status", data.status);
    if (data.type) q = q.eq("type", data.type);
    const r = await q; chk(r);
    const ids = [...new Set((r.data ?? []).map((x: any) => x.store_id))];
    const m = ids.length ? await db.from("merchants").select("id, store_name, service_type, bank_account_number, bank_ifsc, bank_account_holder_name").in("id", ids) : { data: [] };
    const mm = new Map((m.data ?? []).map((x: any) => [x.id, x]));
    return (r.data ?? []).map((x: any) => ({ ...x, merchant: mm.get(x.store_id) ?? null }));
  });

export const getSettlementDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const it = await db.from("merchant_settlement_items").select("order_id").eq("settlement_id", data.id); chk(it);
    const oids = (it.data ?? []).map((x: any) => x.order_id);
    const o = oids.length
      ? await db.from("merchant_orders").select("id, order_number, delivered_at, created_at, item_total, items_total, commission_amount, commission_gst, tcs_amount, tds_amount, total_payable, refund_status").in("id", oids)
      : { data: [], error: null };
    chk(o);
    const adj = await db.from("merchant_settlement_adjustments").select("*").eq("settlement_id", data.id); chk(adj);
    return { orders: o.data ?? [], adjustments: adj.data ?? [] };
  });

export const financeAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "generate" | "approve" | "paid" | "retryRefund"; id?: string; reference?: string; runDate?: string }) => i)
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    if (data.kind === "generate") {
      const r = await rpc(db, "generate_settlement_batch", { _run_date: data.runDate ?? new Date().toISOString().slice(0, 10) }); chk(r); return r.data as any;
    }
    if (data.kind === "approve") { chk(await rpc(db, "staff_approve_settlement", { _settlement_id: data.id })); return { ok: true }; }
    if (data.kind === "paid") {
      if (!data.reference?.trim()) throw new Error("Payment reference is required");
      chk(await rpc(db, "staff_mark_settlement_paid", { _settlement_id: data.id, _reference: data.reference.trim() })); return { ok: true };
    }
    chk(await rpc(db, "staff_retry_store_refund", { _order_id: data.id })); return { ok: true };
  });

export const listRefunds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { status: string }) => ({ status: String(i.status) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const r = await db.from("merchant_orders").select("id, order_number, merchant_id, refund_status, refund_amount, refund_reason, refund_attempts, refund_id, created_at, updated_at")
      .eq("refund_status", data.status).order("created_at", { ascending: false }).limit(300);
    chk(r);
    const ids = [...new Set((r.data ?? []).map((x: any) => x.merchant_id))];
    const m = ids.length ? await db.from("merchants").select("id, store_name").in("id", ids) : { data: [] };
    const mm = new Map((m.data ?? []).map((x: any) => [x.id, x.store_name]));
    return (r.data ?? []).map((x: any) => ({ ...x, store_name: mm.get(x.merchant_id) ?? "—" }));
  });

export const getSettlementInvoice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => ({ id: String(i.id) }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "get_settlement_invoice", { _settlement_id: data.id }); chk(r);
    return r.data as any;
  });

export const getTaxReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { month: string }) => ({ month: String(i.month).slice(0, 7) + "-01" }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "staff_tax_report", { _month: data.month }); chk(r);
    return r.data as any;
  });

export const getCompanyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await (context.supabase as any).from("ops_settings").select("key, value").like("key", "company\\_%"); chk(r);
    const o: Record<string, string> = {};
    for (const x of r.data ?? []) o[String(x.key).replace("company_", "")] = x.value ?? "";
    return o;
  });

export const saveCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Record<string, string>) => ({
    legal_name: String(i.legal_name ?? ""), gstin: String(i.gstin ?? "").toUpperCase(), pan: String(i.pan ?? "").toUpperCase(),
    address: String(i.address ?? ""), state: String(i.state ?? ""),
  }))
  .handler(async ({ data, context }) => {
    chk(await rpc(context.supabase, "staff_save_company_profile", { _p: data })); return { ok: true };
  });
