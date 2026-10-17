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
    const sids = (r.data ?? []).map((x: any) => x.id);
    const ro = new Map<string, number>();
    for (let i = 0; i < sids.length; i += 200) {
      const l = await db.from("merchant_ledger_entries").select("settlement_id, info_amount")
        .eq("entry_type", "round_off_carried").in("settlement_id", sids.slice(i, i + 200));
      for (const e of (l.data ?? []) as any[]) ro.set(e.settlement_id, Number(e.info_amount ?? 0));
    }
    const bc = ids.length ? await db.from("merchant_bank_change_requests").select("merchant_id").eq("status", "pending").in("merchant_id", ids) : { data: [] };
    const pendingBank = new Set(((bc.data ?? []) as any[]).map((x) => x.merchant_id));
    return (r.data ?? []).map((x: any) => ({ ...x, merchant: mm.get(x.store_id) ?? null, round_off_carried: ro.get(x.id) ?? null, bank_change_pending: pendingBank.has(x.store_id) }));
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
  .inputValidator((i: { kind: "generate" | "approve" | "paid" | "retryRefund"; id?: string; refundKind?: string; reference?: string; runDate?: string }) => i)
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
    chk(await rpc(db, "staff_retry_refund", { _kind: data.refundKind ?? "merchant", _id: data.id })); return { ok: true };
  });

export const listRefunds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { status: string }) => ({ status: String(i.status) }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "staff_list_refunds_all", { _status: data.status }); chk(r);
    return (r.data ?? []) as any[];
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
    const r = await rpc(context.supabase, "staff_tax_report_ext", { _month: data.month }); chk(r);
    return r.data as any;
  });

export const getDeliveryGstCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { from: string; to: string }) => ({ from: String(i.from).slice(0, 10), to: String(i.to).slice(0, 10) }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "staff_delivery_gst_check", { _from: data.from, _to: data.to }); chk(r);
    return (r.data ?? []) as any[];
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

export const getDashboardTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await rpc(context.supabase, "staff_dashboard_team", {}); chk(r);
    return (r.data ?? []) as Array<{
      id: string; name: string; phone: string | null; zone: string | null;
      group: "maid" | "washer" | "rider"; busy: boolean; vehicle: string | null;
      job: { kind: string; label: string; status: string; area: string | null } | null;
      free_since: string | null; last_seen: string | null;
    }>;
  });

export const getDashboardMoney = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { from: string; to: string }) => ({ from: String(i.from).slice(0, 10), to: String(i.to).slice(0, 10) }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "staff_dashboard_money", { _from: data.from, _to: data.to }); chk(r);
    return (r.data ?? {}) as Record<string, { gross: number; discount: number; refund?: number; net: number; orders?: number; earning?: number; delivery_failure_refunds?: number }>;
  });

export type DrillRow = { svc: string; kind: string; id: string; num: string; name: string | null; phone: string | null; status: string; label: string | null; at: string | null; amount: number };
export const getDashboardDrill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: string; metric: string; from: string; to: string }) => ({ service: String(i.service), metric: String(i.metric), from: String(i.from).slice(0, 10), to: String(i.to).slice(0, 10) }))
  .handler(async ({ data, context }) => {
    const r = await rpc(context.supabase, "staff_dashboard_drill", { _service: data.service, _metric: data.metric, _from: data.from, _to: data.to }); chk(r);
    return (r.data ?? []) as DrillRow[];
  });
