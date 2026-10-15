import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  financeAction, getCompanyProfile, getSettlementDetail, getSettlementInvoice, getTaxReport,
  listMerchantSettlements, listRefunds, saveCompanyProfile,
} from "@/lib/finance.functions";
import { downloadCommissionInvoicePdf } from "@/lib/commission-invoice-pdf";
import { supabase } from "@/integrations/supabase/client";

const inr = (n: any) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function csvDownload(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

function Pills<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([k, l]) => (
        <Button key={k} size="sm" variant={value === k ? "default" : "outline"} onClick={() => onChange(k)}>{l}</Button>
      ))}
    </div>
  );
}

export type FinanceTab = "settlements" | "instant" | "refunds" | "invoices" | "tax" | "company";

export function FinanceHub({ tab, canEdit, isSuperAdmin }: { tab: FinanceTab; canEdit: boolean; isSuperAdmin: boolean }) {
  if (tab === "settlements") return <SettlementsTab canEdit={canEdit} />;
  if (tab === "instant") return <SettlementTable type="instant" status="approved" canEdit={canEdit} title="Instant — Pay today" />;
  if (tab === "refunds") return <RefundsTab canEdit={canEdit} />;
  if (tab === "invoices") return <InvoicesTab />;
  if (tab === "tax") return <TaxTab />;
  return <CompanyTab canEdit={isSuperAdmin} />;
}

type SChip = "draft" | "approved" | "instant" | "paid" | "carry_forward" | "on_hold";

export function SettlementsTab({ canEdit, extra }: { canEdit: boolean; extra?: React.ReactNode }) {
  const [status, setStatus] = useState<SChip>("draft");
  const qc = useQueryClient();
  const act = useServerFn(financeAction);
  const gen = useMutation({
    mutationFn: () => act({ data: { kind: "generate" } }),
    onSuccess: (r: any) => { toast.success(`Batch generated: ${r?.created ?? 0} settlement(s)`); qc.invalidateQueries({ queryKey: ["fin-settlements"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills value={status} onChange={setStatus} items={[["draft", "Draft"], ["approved", "Approved"], ["instant", "Pay today (instant)"], ["paid", "Paid"], ["carry_forward", "Carry forward"], ["on_hold", "On hold"]]} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Batch runs Wed & Sat</span>
          {canEdit && <Button disabled={gen.isPending} onClick={() => { if (confirm("Generate settlement batch for all merchants now?")) gen.mutate(); }}>Generate settlement batch</Button>}
          {extra}
        </div>
      </div>
      {status === "on_hold" && <p className="text-xs text-muted-foreground">Merchants without bank account / IFSC. Add bank details in Store/Food → store → Commercials to release.</p>}
      {status === "instant"
        ? <SettlementTable type="instant" status="approved" canEdit={canEdit} />
        : <SettlementTable status={status} canEdit={canEdit} />}
    </div>
  );
}

const noBank = (r: any) => !r.merchant?.bank_account_number || !r.merchant?.bank_ifsc;

export function SettlementTable({ status, type, canEdit }: { status: string; type?: string; canEdit: boolean; title?: string }) {
  const fetch = useServerFn(listMerchantSettlements);
  const act = useServerFn(financeAction);
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const onHold = status === "on_hold";
  const q = useQuery({
    queryKey: ["fin-settlements", status, type ?? null],
    queryFn: () => fetch({ data: { status: onHold ? null : status, type: type ?? null } }),
  });
  const all = (q.data ?? []) as any[];
  const rows = onHold
    ? all.filter((r) => (r.status === "draft" || r.status === "approved") && noBank(r))
    : status === "draft" || status === "approved" ? all.filter((r) => !noBank(r) || r.type === "instant") : all;
  const done = (m: string) => { toast.success(m); qc.invalidateQueries({ queryKey: ["fin-settlements"] }); };
  const approve = useMutation({ mutationFn: (id: string) => act({ data: { kind: "approve", id } }), onSuccess: () => done("Approved"), onError: (e) => toast.error(errMsg(e)) });
  const paid = useMutation({ mutationFn: (v: { id: string; reference: string }) => act({ data: { kind: "paid", ...v } }), onSuccess: () => done("Marked paid"), onError: (e) => toast.error(errMsg(e)) });
  const markPaid = (id: string) => { const ref = prompt("Payment reference (UTR / bank ref) — required"); if (ref && ref.trim()) paid.mutate({ id, reference: ref.trim() }); };
  const exportCsv = () => csvDownload(`settlements-${status}.csv`, [
    ["Merchant name", "Account holder", "Bank account", "IFSC", "Amount", "Reference"],
    ...rows.map((r) => [r.merchant?.store_name, r.merchant?.bank_account_holder_name, r.merchant?.bank_account_number, r.merchant?.bank_ifsc, Number(r.net_amount).toFixed(2), r.invoice_no ?? r.id]),
  ]);
  const cols = 13;
  return (
    <div className="space-y-2">
      
      <div className="flex justify-end"><Button size="sm" variant="outline" disabled={!rows.length} onClick={exportCsv}>Export CSV for bank upload</Button></div>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              {["Merchant", "Service", "Period", "Gross", "Commission", "Comm. GST", "TCS", "TDS", "Adjustments", "Instant fee", "Fee GST", "Net", "Invoice", ""].map((h, i) => (
                <th key={i} className={`p-2 ${i >= 3 && i <= 10 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={cols} className="p-3 text-muted-foreground">Loading…</td></tr>}
            {q.isError && <tr><td colSpan={cols} className="p-3 text-destructive">{errMsg(q.error)}</td></tr>}
            {!q.isLoading && !rows.length && <tr><td colSpan={cols} className="p-3 text-muted-foreground">Nothing here.</td></tr>}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="p-2 font-medium">{r.merchant?.store_name ?? "—"}</td>
                  <td className="p-2 capitalize">{r.merchant?.service_type ?? "—"}{r.type === "instant" && <Badge variant="outline" className="ml-1">instant</Badge>}</td>
                  <td className="p-2 whitespace-nowrap">{r.period_from} → {r.period_to}</td>
                  <td className="p-2 text-right">{inr(r.gross_amount)}</td>
                  <td className="p-2 text-right">{inr(r.commission_total)}</td>
                  <td className="p-2 text-right">{inr(r.commission_gst_total)}</td>
                  <td className="p-2 text-right">{inr(r.tcs_total)}</td>
                  <td className="p-2 text-right">{inr(r.tds_total)}</td>
                  <td className="p-2 text-right">{inr(r.adjustment_total)}</td>
                  <td className="p-2 text-right">{inr(r.instant_fee)}</td>
                  <td className="p-2 text-right">{inr(r.instant_fee_gst ?? 0)}</td>
                  <td className="p-2 text-right font-semibold">{inr(r.net_amount)}</td>
                  <td className="p-2 text-xs">{r.invoice_no ?? "—"}{r.reference && <div className="text-muted-foreground">Ref {r.reference}</div>}</td>
                  <td className="p-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {canEdit && r.status === "draft" && <Button size="sm" variant="outline" onClick={() => approve.mutate(r.id)}>Approve</Button>}{" "}
                    {canEdit && (r.status === "draft" || r.status === "approved") && <Button size="sm" onClick={() => markPaid(r.id)}>Mark paid</Button>}
                  </td>
                </tr>
                {open === r.id && <tr className="border-b bg-muted/20"><td colSpan={cols} className="p-3"><SettlementDetail id={r.id} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettlementDetail({ id }: { id: string }) {
  const fetch = useServerFn(getSettlementDetail);
  const q = useQuery({ queryKey: ["fin-settlement-detail", id], queryFn: () => fetch({ data: { id } }) });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-xs text-destructive">{errMsg(q.error)}</p>;
  const d = q.data as any;
  return (
    <div className="grid lg:grid-cols-2 gap-4 text-xs">
      <div>
        <p className="font-semibold mb-1">Orders ({d.orders.length})</p>
        <table className="w-full">
          <thead className="text-muted-foreground"><tr><th className="text-left p-1">Order</th><th className="text-right p-1">Items</th><th className="text-right p-1">Commission</th><th className="text-right p-1">GST</th><th className="text-right p-1">TCS</th><th className="text-right p-1">TDS</th></tr></thead>
          <tbody>
            {d.orders.map((o: any) => (
              <tr key={o.id} className="border-t"><td className="p-1">{o.order_number}</td><td className="p-1 text-right">{inr(o.item_total ?? o.items_total)}</td><td className="p-1 text-right">{inr(o.commission_amount)}</td><td className="p-1 text-right">{inr(o.commission_gst)}</td><td className="p-1 text-right">{inr(o.tcs_amount)}</td><td className="p-1 text-right">{inr(o.tds_amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="font-semibold mb-1">Adjustment lines ({d.adjustments.length})</p>
        {!d.adjustments.length && <p className="text-muted-foreground">None.</p>}
        {d.adjustments.map((a: any) => (
          <div key={a.id} className="flex justify-between border-t py-1"><span>{a.reason}</span><span className="font-medium">{inr(a.amount)}</span></div>
        ))}
      </div>
    </div>
  );
}

export function RefundsTab({ canEdit }: { canEdit: boolean }) {
  const [s, setS] = useState<"refund_pending" | "processing" | "failed" | "done">("refund_pending");
  const fetch = useServerFn(listRefunds);
  const act = useServerFn(financeAction);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fin-refunds", s], queryFn: () => fetch({ data: { status: s } }) });
  const retry = useMutation({
    mutationFn: (r: { id: string; kind: string }) => act({ data: { kind: "retryRefund", id: r.id, refundKind: r.kind } }),
    onSuccess: () => { toast.success("Refund retry started"); qc.invalidateQueries({ queryKey: ["fin-refunds"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = (q.data ?? []) as any[];
  return (
    <div className="space-y-4">
      
      <Pills value={s} onChange={setS} items={[["refund_pending", "Pending"], ["processing", "Processing"], ["failed", "Failed"], ["done", "Done"]]} />
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="p-2 text-left">Order</th><th className="p-2 text-left">Service</th><th className="p-2 text-left">Store / item</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Refunded to</th><th className="p-2 text-left">Reason</th><th className="p-2 text-right">Attempts</th><th className="p-2 text-left">Refund ID</th><th className="p-2"></th></tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={9} className="p-3 text-muted-foreground">Loading…</td></tr>}
            {!q.isLoading && !rows.length && <tr><td colSpan={9} className="p-3 text-muted-foreground">Nothing here.</td></tr>}
            {rows.map((r) => (
              <tr key={r.kind + r.id} className="border-b last:border-0">
                <td className="p-2">{r.order_number}</td><td className="p-2">{r.service}</td><td className="p-2">{r.store_name}</td>
                <td className="p-2 text-right">{inr(r.refund_amount)}</td><td className="p-2">{r.refunded_to}</td><td className="p-2 text-xs">{r.refund_error ?? r.refund_reason ?? "—"}</td>
                <td className="p-2 text-right">{r.refund_attempts ?? 0}</td><td className="p-2 text-xs">{r.refund_id ?? "—"}</td>
                <td className="p-2">{canEdit && s === "failed" && <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate({ id: r.id, kind: r.kind })}>Retry</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function InvoicesTab() {
  const fetch = useServerFn(listMerchantSettlements);
  const inv = useServerFn(getSettlementInvoice);
  const q = useQuery({ queryKey: ["fin-settlements", null, null], queryFn: () => fetch({ data: {} }) });
  const rows = ((q.data ?? []) as any[]).filter((r) => r.invoice_no);
  const dl = async (id: string) => {
    try {
      const { data: s } = await supabase.from("ops_settings").select("value").eq("key", "sac_commission").maybeSingle();
      await downloadCommissionInvoicePdf(await inv({ data: { id } }), s?.value || "998599");
    } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div className="space-y-4">
      
      <p className="text-xs text-muted-foreground">One invoice per settlement. GST is split CGST + SGST when the merchant's state matches the company state, otherwise IGST. Set company details in Company Profile.</p>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="p-2 text-left">Invoice</th><th className="p-2 text-left">Merchant</th><th className="p-2 text-left">Period</th><th className="p-2 text-right">Commission</th><th className="p-2 text-right">GST</th><th className="p-2 text-left">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={9} className="p-3 text-muted-foreground">Loading…</td></tr>}
            {!q.isLoading && !rows.length && <tr><td colSpan={8} className="p-3 text-muted-foreground">No invoices yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.kind + r.id} className="border-b last:border-0">
                <td className="p-2 font-medium">{r.invoice_no}</td><td className="p-2">{r.merchant?.store_name}</td>
                <td className="p-2">{r.period_from} → {r.period_to}</td><td className="p-2 text-right">{inr(r.commission_total)}</td>
                <td className="p-2 text-right">{inr(r.commission_gst_total)}</td><td className="p-2">{r.status}</td>
                <td className="p-2"><Button size="sm" variant="outline" onClick={() => dl(r.id)}>PDF</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TaxTab() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const fetch = useServerFn(getTaxReport);
  const q = useQuery({ queryKey: ["fin-tax", month], queryFn: () => fetch({ data: { month } }) });
  const d = q.data as any;
  const s = d?.summary ?? {};
  const lines: [string, number][] = [
    ["Food GST 9(5) collected", s.food_gst_9_5], ["Store delivery GST", s.store_delivery_gst], ["Food delivery GST", s.food_delivery_gst],
    ["Parcel delivery GST", s.parcel_delivery_gst], ["Commission GST", s.commission_gst], ["Platform fee GST", s.platform_fee_gst],
    ["TCS (total)", s.tcs], ["TDS 194-O (total)", s.tds],
    ["Clean Home GST", s.maid_gst], ["Clean Auto GST", s.wash_gst], ["Instant fee GST", s.instant_fee_gst],
    ["GST paid on expenses (input credit)", s.expense_input_gst],
  ];
  const m = (d?.merchants ?? []) as any[];
  const r = d?.refunds ?? {};
  const rl = (r.lines ?? []) as any[];
  const f2 = (v: any) => Number(v || 0).toFixed(2);
  const rLines: [string, number][] = [
    ["Food GST 9(5) collected", r.food_gst_9_5], ["Store delivery GST", r.store_delivery_gst], ["Food delivery GST", r.food_delivery_gst],
    ["Parcel delivery GST", r.parcel_delivery_gst], ["Commission GST", r.commission_gst], ["Platform fee GST", r.platform_fee_gst],
    ["TCS (total)", r.tcs], ["TDS 194-O (total)", r.tds],
  ];
  const cnHead = ["Order", "Merchant", "Service", "GSTIN", "PAN", "Paid on", "Refunded on", "Refund amount", "Taxable value", "Food GST", "Delivery GST", "Platform fee GST", "Commission GST", "TCS", "TDS"];
  const cnRows = rl.map((x) => [x.order_number, x.merchant, x.service, x.gstin ?? "", x.pan ?? "", String(x.paid_at ?? "").slice(0, 10), String(x.refunded_at ?? "").slice(0, 10), f2(x.refund_amount), f2(x.taxable_value), f2(x.gst_items), f2(x.gst_delivery), f2(x.gst_platform), f2(x.commission_gst), f2(x.tcs), f2(x.tds)]);
  const cnSection = (cols: (x: any) => any[], head: string[]) => [[], ["Refunds / credit notes"], head, ...rl.map(cols)];
  const exp = (kind: "summary" | "tcs" | "tds") => {
    if (kind === "summary") csvDownload(`tax-summary-${month}.csv`, [["Head", "Amount"], ...lines.map(([k, v]) => [k, f2(v)]), [], ["Refunds / credit notes"], ["Head", "Amount"], ...rLines.map(([k, v]) => [k, f2(v)]), [], cnHead, ...cnRows]);
    if (kind === "tcs") csvDownload(`tcs-gstr8-${month}.csv`, [["Merchant", "GSTIN", "Service", "Orders", "Taxable value", "TCS"], ...m.map((x) => [x.name, x.gstin ?? "", x.service, x.orders, f2(x.taxable_value), f2(x.tcs)]),
      ...cnSection((x) => [x.order_number, x.merchant, x.gstin ?? "", x.service, String(x.refunded_at ?? "").slice(0, 10), f2(x.taxable_value), f2(x.tcs)], ["Order", "Merchant", "GSTIN", "Service", "Refunded on", "Taxable value", "TCS"])]);
    if (kind === "tds") csvDownload(`tds-194o-${month}.csv`, [["Merchant", "PAN", "Service", "Orders", "Gross value", "TDS"], ...m.map((x) => [x.name, x.pan ?? "", x.service, x.orders, f2(x.taxable_value), f2(x.tds)]),
      ...cnSection((x) => [x.order_number, x.merchant, x.pan ?? "", x.service, String(x.refunded_at ?? "").slice(0, 10), f2(x.taxable_value), f2(x.tds)], ["Order", "Merchant", "PAN", "Service", "Refunded on", "Gross value", "TDS"])]);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs text-muted-foreground">Orders counted in the month they were paid (invoice date). Refunds appear as negative credit notes in the month the refund completed.</p></div>
        <div><Label>Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      </div>
      {q.isError && <p className="text-destructive text-sm">{errMsg(q.error)}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {lines.map(([k, v]) => (<div key={k} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-lg font-semibold">{inr(v)}</p></div>))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => exp("summary")}>Summary CSV</Button>
        <Button size="sm" variant="outline" onClick={() => exp("tcs")}>TCS per GSTIN (GSTR-8) CSV</Button>
        <Button size="sm" variant="outline" onClick={() => exp("tds")}>TDS 194-O per PAN CSV</Button>
      </div>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="p-2 text-left">Merchant</th><th className="p-2 text-left">GSTIN</th><th className="p-2 text-left">PAN</th><th className="p-2 text-right">Orders</th><th className="p-2 text-right">Value</th><th className="p-2 text-right">TCS</th><th className="p-2 text-right">TDS</th></tr></thead>
          <tbody>
            {!m.length && <tr><td colSpan={8} className="p-3 text-muted-foreground">{q.isLoading ? "Loading…" : "No paid orders this month."}</td></tr>}
            {m.map((x) => (
              <tr key={x.merchant_id} className="border-b last:border-0"><td className="p-2">{x.name}</td><td className="p-2 text-xs">{x.gstin ?? "—"}</td><td className="p-2 text-xs">{x.pan ?? "—"}</td><td className="p-2 text-right">{x.orders}</td><td className="p-2 text-right">{inr(x.taxable_value)}</td><td className="p-2 text-right">{inr(x.tcs)}</td><td className="p-2 text-right">{inr(x.tds)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="text-lg font-semibold">Refunds / credit notes</h2>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="p-2 text-left">Order</th><th className="p-2 text-left">Merchant</th><th className="p-2 text-left">Refunded on</th><th className="p-2 text-right">Refund</th><th className="p-2 text-right">GST reversed</th><th className="p-2 text-right">TCS</th><th className="p-2 text-right">TDS</th></tr></thead>
          <tbody>
            {!rl.length && <tr><td colSpan={8} className="p-3 text-muted-foreground">No refunds completed this month.</td></tr>}
            {rl.map((x) => (
              <tr key={x.order_number} className="border-b last:border-0"><td className="p-2">{x.order_number}</td><td className="p-2">{x.merchant}</td><td className="p-2 text-xs">{String(x.refunded_at ?? "").slice(0, 10)}</td><td className="p-2 text-right">{inr(x.refund_amount)}</td><td className="p-2 text-right">{inr(Number(x.gst_items || 0) + Number(x.gst_delivery || 0) + Number(x.gst_platform || 0))}</td><td className="p-2 text-right">{inr(x.tcs)}</td><td className="p-2 text-right">{inr(x.tds)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyTab({ canEdit }: { canEdit: boolean }) {
  const fetch = useServerFn(getCompanyProfile);
  const save = useServerFn(saveCompanyProfile);
  const q = useQuery({ queryKey: ["company-profile"], queryFn: () => fetch() });
  const [f, setF] = useState<Record<string, string> | null>(null);
  const v = f ?? (q.data as Record<string, string> | undefined) ?? {};
  const m = useMutation({ mutationFn: () => save({ data: v }), onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(errMsg(e)) });
  const field = (k: string, l: string) => (
    <div><Label>{l}</Label><Input disabled={!canEdit} value={v[k] ?? ""} onChange={(e) => setF({ ...v, [k]: e.target.value })} /></div>
  );
  return (
    <div className="space-y-4 max-w-2xl">
      
      <p className="text-xs text-muted-foreground">Printed on every commission invoice. {canEdit ? "" : "Only super admin can edit."}</p>
      <div className="rounded-lg border bg-card p-4 grid sm:grid-cols-2 gap-4">
        {field("legal_name", "Legal name")}{field("gstin", "GSTIN")}{field("pan", "PAN")}{field("state", "State")}
        <div className="sm:col-span-2">{field("address", "Address")}</div>
        {canEdit && <div className="sm:col-span-2 flex justify-end"><Button disabled={m.isPending} onClick={() => m.mutate()}>Save</Button></div>}
      </div>
    </div>
  );
}
