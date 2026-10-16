import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { filterInputCls, filterSelectCls } from "@/components/section-chrome";
import {
  getMerchantLedgerSummary, getMerchantLedger, getMerchantSettlementsList, getMerchantSettlementStatement,
} from "@/lib/merchant-ledger.functions";

const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const d = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "—");
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TYPES: [string, string][] = [
  ["sale", "Sale"], ["commission", "Commission"], ["commission_gst", "Commission GST"], ["tcs", "TCS"], ["tds", "TDS"],
  ["refund", "Refund"], ["adjustment", "Adjustment"], ["instant_fee", "Instant fee"], ["instant_fee_gst", "Instant fee GST"],
  ["payout", "Settlement payout"], ["round_off_carried", "Round-off carried"],
];
const typeLabel = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t.replace(/_/g, " ");
const PAGE = 50;

function Card({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] font-bold uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function MerchantLedgerPane({ storeId }: { storeId: string }) {
  const sumFn = useServerFn(getMerchantLedgerSummary);
  const ledFn = useServerFn(getMerchantLedger);
  const setFn = useServerFn(getMerchantSettlementsList);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [stmt, setStmt] = useState<string | null>(null);

  const sum = useQuery({ queryKey: ["mledger-sum", storeId], queryFn: () => sumFn({ data: { storeId } }) });
  const led = useQuery({
    queryKey: ["mledger", storeId, from, to, type, page],
    queryFn: () => ledFn({ data: { storeId, from, to, types: type ? [type] : null, limit: PAGE, offset: page * PAGE } }),
  });
  const setl = useQuery({ queryKey: ["mledger-setl", storeId], queryFn: () => setFn({ data: { storeId, limit: 100 } }) });

  const s = sum.data ?? {};
  const rows = (led.data?.rows ?? []) as any[];
  const total = Number(led.data?.total ?? 0);
  const hist = (setl.data?.rows ?? []) as any[];

  return (
    <div className="space-y-5">
      {sum.isError && <p className="text-sm text-destructive">{err(sum.error)}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Eligible balance" value={inr(s.balance)} hint={`This week: sales ${inr(s.week_sales)} · deductions ${inr(s.week_deductions)}`} />
        <Card label="Carried forward" value={inr(s.carry_forward_estimate)} hint="Round-off / below ₹100 rolls to next payout" />
        <Card label="Next payout" value={d(s.next_payout_date)} hint="Batch runs Wed & Sat" />
        <Card label="Payout estimate" value={inr(s.next_payout_estimate)} hint="Rounded down to ₹100" />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <h3 className="text-sm font-semibold mr-auto">Ledger</h3>
          <label className="text-xs text-muted-foreground">From <input type="date" className={filterInputCls} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></label>
          <label className="text-xs text-muted-foreground">To <input type="date" className={filterInputCls} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></label>
          <select className={filterSelectCls} value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
            <option value="">All types</option>
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="border-b">
              <th className="p-2 text-left">Date</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Reference</th>
              <th className="p-2 text-right">+ / −</th><th className="p-2 text-right">Running balance</th>
            </tr></thead>
            <tbody>
              {led.isLoading && <tr><td colSpan={5} className="p-3 text-muted-foreground">Loading…</td></tr>}
              {led.isError && <tr><td colSpan={5} className="p-3 text-destructive">{err(led.error)}</td></tr>}
              {!led.isLoading && !rows.length && <tr><td colSpan={5} className="p-3 text-muted-foreground">No ledger entries.</td></tr>}
              {rows.map((r) => {
                const amt = Number(r.amount ?? 0);
                const info = r.entry_type === "round_off_carried";
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 whitespace-nowrap">{dt(r.entry_at)}</td>
                    <td className="p-2">{typeLabel(r.entry_type)}</td>
                    <td className="p-2 text-xs">
                      {r.order_number ? `Order #${r.order_number}` : r.settlement_id
                        ? <button className="text-primary underline" onClick={() => setStmt(r.settlement_id)}>{r.invoice_no ?? "Settlement"}</button>
                        : r.note ?? "—"}
                    </td>
                    <td className={`p-2 text-right font-medium ${info ? "text-muted-foreground" : amt < 0 ? "text-destructive" : "text-primary"}`}>
                      {info ? `${inr(r.info_amount)} (info)` : `${amt >= 0 ? "+" : "−"}${inr(Math.abs(amt))}`}
                    </td>
                    <td className="p-2 text-right">{inr(r.running_balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Settlement history</h3>
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr className="border-b">
              <th className="p-2 text-left">Period</th><th className="p-2 text-left">Type</th><th className="p-2 text-right">Orders</th>
              <th className="p-2 text-right">Gross</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Round-off carried</th>
              <th className="p-2 text-left">Status</th><th className="p-2 text-left">Invoice</th><th className="p-2" />
            </tr></thead>
            <tbody>
              {setl.isLoading && <tr><td colSpan={9} className="p-3 text-muted-foreground">Loading…</td></tr>}
              {setl.isError && <tr><td colSpan={9} className="p-3 text-destructive">{err(setl.error)}</td></tr>}
              {!setl.isLoading && !hist.length && <tr><td colSpan={9} className="p-3 text-muted-foreground">No settlements yet.</td></tr>}
              {hist.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{x.period_from ?? "—"} → {x.period_to ?? "—"}</td>
                  <td className="p-2 capitalize">{x.type}</td>
                  <td className="p-2 text-right">{x.order_count ?? 0}</td>
                  <td className="p-2 text-right">{inr(x.gross_amount)}</td>
                  <td className="p-2 text-right font-semibold">{inr(x.net_amount)}</td>
                  <td className="p-2 text-right">{x.round_off_carried ? inr(x.round_off_carried) : "—"}</td>
                  <td className="p-2"><Badge variant="outline">{String(x.status).replace(/_/g, " ")}</Badge></td>
                  <td className="p-2 text-xs">{x.invoice_no ?? "—"}{x.reference && <div className="text-muted-foreground">Ref {x.reference}</div>}</td>
                  <td className="p-2"><Button size="sm" variant="outline" onClick={() => setStmt(x.id)}>Statement</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Read-only. Pay and manage settlements in Finance → Merchants.</p>
      </div>

      {stmt && <StatementDialog id={stmt} onClose={() => setStmt(null)} />}
    </div>
  );
}

function StatementDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const fn = useServerFn(getMerchantSettlementStatement);
  const q = useQuery({ queryKey: ["mledger-stmt", id], queryFn: () => fn({ data: { settlementId: id } }) });
  const st = q.data?.settlement ?? {};
  const m = q.data?.merchant ?? {};
  const orders = (q.data?.orders ?? []) as any[];
  const adj = (q.data?.adjustments ?? []) as any[];
  const line = (k: string, v: unknown, neg = false) => (
    <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{neg ? "−" : ""}{inr(v)}</span></div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Settlement statement {st.invoice_no ? `· ${st.invoice_no}` : ""}</DialogTitle></DialogHeader>
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
        {q.data && (
          <div className="space-y-4 text-sm">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-muted-foreground">GSTIN {m.gstin || "—"} · PAN {m.pan || "—"}</div>
                <div className="text-xs text-muted-foreground">{m.address}</div>
              </div>
              <div className="rounded-lg border p-3 text-xs space-y-0.5">
                <div>Period: {st.period_from ?? "—"} → {st.period_to ?? "—"}</div>
                <div>Type: <span className="capitalize">{st.type}</span> · Status: {String(st.status ?? "").replace(/_/g, " ")}</div>
                <div>Paid on: {dt(st.paid_at)}{st.reference ? ` · Ref ${st.reference}` : ""}</div>
              </div>
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr className="border-b">
                  {["Order", "Delivered", "Items", "Commission", "Comm. GST", "TCS", "TDS", "Net"].map((h, i) => <th key={h} className={`p-2 ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {!orders.length && <tr><td colSpan={8} className="p-2 text-muted-foreground">No orders in this settlement.</td></tr>}
                  {orders.map((o) => (
                    <tr key={o.order_id} className="border-b last:border-0">
                      <td className="p-2">#{o.order_number}</td><td className="p-2">{dt(o.delivered_at)}</td>
                      <td className="p-2 text-right">{inr(o.items_total)}</td><td className="p-2 text-right">{inr(o.commission)}</td>
                      <td className="p-2 text-right">{inr(o.commission_gst)}</td><td className="p-2 text-right">{inr(o.tcs)}</td>
                      <td className="p-2 text-right">{inr(o.tds)}</td><td className="p-2 text-right font-medium">{inr(o.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {adj.length > 0 && (
              <div className="rounded-lg border p-3 space-y-1">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Adjustments</div>
                {adj.map((a) => <div key={a.id} className="flex justify-between text-xs"><span>{a.reason ?? "Adjustment"}</span><span>{inr(a.amount)}</span></div>)}
              </div>
            )}
            <div className="rounded-lg border p-3 space-y-1 max-w-sm ml-auto">
              {line("Gross", st.gross_amount)}
              {line("Commission", st.commission_total, true)}
              {line("Commission GST", st.commission_gst_total, true)}
              {line("TCS", st.tcs_total, true)}
              {line("TDS", st.tds_total, true)}
              {line("Adjustments", st.adjustment_total)}
              {Number(st.instant_fee) > 0 && line("Instant fee", st.instant_fee, true)}
              {Number(st.instant_fee_gst) > 0 && line("Instant fee GST", st.instant_fee_gst, true)}
              <div className="flex justify-between font-semibold border-t pt-1"><span>Paid</span><span>{inr(st.net_amount)}</span></div>
              {q.data.round_off_carried != null && <div className="flex justify-between text-xs text-muted-foreground"><span>Round-off carried forward</span><span>{inr(q.data.round_off_carried)}</span></div>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
