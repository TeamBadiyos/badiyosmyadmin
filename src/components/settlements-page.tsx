import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { DateInput } from "@/components/date-input";
import { listSettlements, listSettlementItems, syncSettlementsNow, setSettlementTally } from "@/lib/settlements.functions";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

type S = { id: string; amount: number; fees: number; tax: number; gross_amount: number; status: string | null; utr: string | null; settled_at: string | null; bank_reconciled: boolean; bank_reference_note: string | null; bank_reconciled_at: string | null };

export function SettlementsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();
  const fetchList = useServerFn(listSettlements);
  const sync = useServerFn(syncSettlementsNow);
  const tally = useServerFn(setSettlementTally);
  const { data, isLoading } = useQuery({ queryKey: ["settlements", from, to], queryFn: () => fetchList({ data: { from, to } }) });
  const rows = (data?.rows ?? []) as S[];
  const sum = (f: (r: S) => number) => rows.reduce((a, r) => a + Number(f(r) || 0), 0);
  const pending = rows.filter((r) => !r.bank_reconciled);

  async function doSync() {
    setSyncing(true);
    try {
      const r = await sync({ data: { days: 30 } });
      if (r.ok) toast.success(`Synced ${r.count} settlements`); else toast.error(`Sync failed: ${r.error}`);
      qc.invalidateQueries({ queryKey: ["settlements"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Sync failed"); }
    setSyncing(false);
  }
  async function doTally(r: S, reconciled: boolean) {
    const note = reconciled ? window.prompt("Bank statement reference / note (optional)", r.utr ?? "") : null;
    if (reconciled && note === null) return;
    await tally({ data: { id: r.id, reconciled, note: note ?? undefined } });
    toast.success(reconciled ? "Marked as tallied with bank" : "Tally removed");
    qc.invalidateQueries({ queryKey: ["settlements"] });
  }

  const last = data?.lastSync as { created_at: string; ok: boolean; trigger: string; error?: string } | null | undefined;
  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-[18px] p-5 flex flex-wrap items-end gap-4">
        <div><label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">From</label>
          <DateInput value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px]" /></div>
        <div><label className="block text-[11px] font-bold uppercase text-muted-foreground mb-1">To</label>
          <DateInput value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px]" /></div>
        <div className="ml-auto text-right">
          <button onClick={doSync} disabled={syncing} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[14px] font-semibold disabled:opacity-60">
            {syncing ? "Syncing…" : "Sync now (last 30 days)"}
          </button>
          <p className="text-[12px] text-muted-foreground mt-1">
            Auto-sync every night 12:00 AM · Last: {last ? `${fmt(last.created_at)} (${last.trigger}, ${last.ok ? "OK" : "failed"})` : "never"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ["Gross collected", sum((r) => r.gross_amount)],
          ["Razorpay fees", sum((r) => r.fees - r.tax)],
          ["GST on fees", sum((r) => r.tax)],
          ["Net settled to bank", sum((r) => r.amount)],
          [`Pending tally (${pending.length})`, pending.reduce((a, r) => a + Number(r.amount), 0)],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card border border-border rounded-[16px] p-4">
            <p className="text-[12px] text-muted-foreground">{l}</p>
            <p className="text-[20px] font-bold">{inr.format(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-muted-foreground text-left border-b border-border">
            <tr>{["Settled on", "Settlement ID", "Gross", "Fees", "GST", "Net to bank", "UTR", "Bank tally", ""].map((h) => <th key={h} className="p-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && !rows.length && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No settlements in these dates. Click “Sync now”.</td></tr>}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-border">
                  <td className="p-3 whitespace-nowrap">{fmt(r.settled_at)}</td>
                  <td className="p-3 font-mono text-[12px]">{r.id}</td>
                  <td className="p-3">{inr.format(r.gross_amount)}</td>
                  <td className="p-3 text-destructive">{inr.format(r.fees - r.tax)}</td>
                  <td className="p-3 text-destructive">{inr.format(r.tax)}</td>
                  <td className="p-3 font-semibold">{inr.format(r.amount)}</td>
                  <td className="p-3 font-mono text-[12px]">{r.utr ?? "—"}</td>
                  <td className="p-3">
                    {r.bank_reconciled ? (
                      <button onClick={() => doTally(r, false)} className="px-2 py-1 rounded-full bg-primary/15 text-primary text-[12px] font-semibold" title={r.bank_reference_note ?? ""}>✓ Tallied</button>
                    ) : (
                      <button onClick={() => doTally(r, true)} className="px-2 py-1 rounded-full border border-border text-[12px] font-semibold">Mark tallied</button>
                    )}
                  </td>
                  <td className="p-3"><button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-primary text-[12px] font-semibold">{open === r.id ? "Hide" : "Orders"}</button></td>
                </tr>
                {open === r.id && <tr key={r.id + "-d"}><td colSpan={9} className="p-3 bg-muted/40"><Items id={r.id} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Items({ id }: { id: string }) {
  const fetchItems = useServerFn(listSettlementItems);
  const { data = [], isLoading } = useQuery({ queryKey: ["settlement-items", id], queryFn: () => fetchItems({ data: { settlementId: id } }) });
  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!data.length) return <p className="text-muted-foreground">Per-payment breakdown not available yet for this settlement.</p>;
  return (
    <table className="w-full text-[12px]">
      <thead className="text-muted-foreground text-left"><tr>{["Time", "Type", "Payment / Refund", "Amount", "Fee", "GST", "Credit", "Debit"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
      <tbody>
        {(data as Array<Record<string, any>>).map((i) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
          <tr key={i.id} className="border-t border-border">
            <td className="p-2">{fmt(i.txn_at)}</td><td className="p-2">{i.type}</td><td className="p-2 font-mono">{i.entity_id}</td>
            <td className="p-2">{inr.format(i.amount)}</td><td className="p-2">{inr.format(i.fee - i.tax)}</td><td className="p-2">{inr.format(i.tax)}</td>
            <td className="p-2">{inr.format(i.credit)}</td><td className="p-2">{inr.format(i.debit)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
