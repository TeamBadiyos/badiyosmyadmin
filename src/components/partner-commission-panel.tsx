import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getCommissionOptions,
  previewPartnerCommission,
  savePartnerCommission,
  listPartnerCommissions,
  updatePartnerCommissionStatus,
  type CommissionOrder,
  type CommissionBatch,
} from "@/lib/partner-commission.functions";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmt = (s: string) =>
  new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function lastWeek() {
  const t = new Date();
  const dow = (t.getDay() + 6) % 7; // Mon=0
  const mon = new Date(t); mon.setDate(t.getDate() - dow - 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: iso(mon), end: iso(sun) };
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Kuch galat hua, dobara try karein.");

function downloadCsv(name: string, partner: string, start: string, end: string, rows: CommissionOrder[]) {
  const head = ["Order ID", "Completed", "Service", "Zone", "Order amount", "Commission"];
  const lines = [
    [`Area Partner: ${partner}`], [`Period: ${start} to ${end}`], [],
    head,
    ...rows.map((r) => [r.id, fmt(r.completed_at), r.service_label, r.zone_name, r.amount, r.commission]),
    [], ["Total", "", "", "", rows.reduce((s, r) => s + r.amount, 0), rows.reduce((s, r) => s + r.commission, 0)],
  ];
  const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
  a.download = `${name}.csv`; a.click();
}

async function downloadPdf(name: string, partner: string, start: string, end: string, rows: CommissionOrder[], status: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const rs = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");
  doc.setFontSize(16); doc.text("Badiyos - Area Partner Commission", 14, 16);
  doc.setFontSize(10);
  doc.text(`Partner: ${partner}`, 14, 24);
  doc.text(`Period: ${fmt(start)} - ${fmt(end)}   Status: ${status}`, 14, 30);
  const total = rows.reduce((s, r) => s + r.commission, 0);
  doc.text(`Orders: ${rows.length}   Order value: ${rs(rows.reduce((s, r) => s + r.amount, 0))}   Commission: ${rs(total)}`, 14, 36);
  let y = 46;
  const cols = [14, 40, 68, 130, 160, 185];
  const header = () => {
    doc.setFont("helvetica", "bold");
    ["Order", "Completed", "Service", "Zone", "Amount", "Comm."].forEach((h, i) => doc.text(h, cols[i], y));
    doc.setFont("helvetica", "normal"); y += 6;
  };
  header();
  for (const r of rows) {
    if (y > 282) { doc.addPage(); y = 16; header(); }
    doc.text(r.id.slice(0, 8), cols[0], y);
    doc.text(fmt(r.completed_at), cols[1], y);
    doc.text(r.service_label.slice(0, 32), cols[2], y);
    doc.text(r.zone_name.slice(0, 14), cols[3], y);
    doc.text(rs(r.amount), cols[4], y);
    doc.text(rs(r.commission), cols[5], y);
    y += 6;
  }
  y += 4; doc.setFont("helvetica", "bold"); doc.text(`Total commission: ${rs(total)}`, 14, y);
  doc.save(`${name}.pdf`);
}

export function PartnerCommissionPanel() {
  const qc = useQueryClient();
  const optsFn = useServerFn(getCommissionOptions);
  const previewFn = useServerFn(previewPartnerCommission);
  const saveFn = useServerFn(savePartnerCommission);
  const listFn = useServerFn(listPartnerCommissions);
  const statusFn = useServerFn(updatePartnerCommissionStatus);

  const lw = useMemo(lastWeek, []);
  const [start, setStart] = useState(lw.start);
  const [end, setEnd] = useState(lw.end);
  const [partnerId, setPartnerId] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [orders, setOrders] = useState<CommissionOrder[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CommissionBatch | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: opts } = useQuery({ queryKey: ["pc-opts"], queryFn: () => optsFn() });
  const { data: batches = [] } = useQuery({ queryKey: ["pc-batches"], queryFn: () => listFn() });
  const partnerName = opts?.partners.find((p) => p.id === partnerId)?.name ?? "Partner";

  const selected = (orders ?? []).filter((o) => !o.locked && !excluded.has(o.id));
  const total = selected.reduce((s, o) => s + o.commission, 0);
  const fileName = `Commission_${partnerName.replace(/\s+/g, "_")}_${start}_to_${end}`;

  async function generate(batch?: CommissionBatch) {
    const pid = batch?.partner_id ?? partnerId;
    if (!pid) return toast.error("Area partner select karein.");
    setBusy(true);
    try {
      const rows = await previewFn({ data: { partnerId: pid, start: batch?.week_start ?? start, end: batch?.week_end ?? end, services: batch ? [] : services, batchId: batch?.id } });
      setOrders(rows);
      setExcluded(batch ? new Set(rows.filter((r) => !batch.booking_ids.includes(r.id)).map((r) => r.id)) : new Set());
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await saveFn({ data: { batchId: editing?.id, partnerId, start, end, bookingIds: selected.map((o) => o.id), notes: notes || undefined } });
      toast.success(`Commission saved: ${inr(r.total)}`);
      setOrders(null); setEditing(null); setNotes("");
      qc.invalidateQueries({ queryKey: ["pc-batches"] });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  function startEdit(b: CommissionBatch) {
    setEditing(b); setPartnerId(b.partner_id); setStart(b.week_start); setEnd(b.week_end); setServices([]); setNotes(b.notes ?? "");
    generate(b);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function act(b: CommissionBatch, action: "discard" | "paid" | "unpaid") {
    let extra: { reason?: string; paidOn?: string; utr?: string; mode?: string } = {};
    if (action === "discard") {
      const reason = window.prompt("Delete karne ka reason likhein:");
      if (!reason?.trim()) return;
      extra = { reason };
    } else if (action === "paid") {
      const paidOn = window.prompt("Payment date (YYYY-MM-DD):", iso(new Date()));
      if (!paidOn) return;
      const utr = window.prompt("UTR / reference no (optional):") ?? "";
      const mode = window.prompt("Payment mode (UPI / Bank / Cash):", "UPI") ?? "";
      extra = { paidOn, utr, mode };
    } else if (!window.confirm("Is batch ko unpaid karna hai?")) return;
    try {
      await statusFn({ data: { batchId: b.id, action, ...extra } });
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["pc-batches"] });
    } catch (e) { toast.error(errMsg(e)); }
  }

  async function exportBatch(b: CommissionBatch, kind: "pdf" | "csv") {
    try {
      const rows = (await previewFn({ data: { partnerId: b.partner_id, start: b.week_start, end: b.week_end, services: [], batchId: b.id } }))
        .filter((r) => b.booking_ids.includes(r.id));
      const n = `Commission_${b.partner_name.replace(/\s+/g, "_")}_${b.week_start}_to_${b.week_end}`;
      if (kind === "pdf") await downloadPdf(n, b.partner_name, b.week_start, b.week_end, rows, b.status);
      else downloadCsv(n, b.partner_name, b.week_start, b.week_end, rows);
    } catch (e) { toast.error(errMsg(e)); }
  }

  const input = "h-10 rounded-[10px] border border-border bg-background px-3 text-[14px] text-foreground";
  const btn = "h-10 rounded-[10px] px-4 text-[13px] font-semibold whitespace-nowrap disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-[18px] p-4 sm:p-6">
        <h3 className="text-[15px] font-bold text-foreground mb-1">{editing ? "Edit commission batch" : "Generate commission"}</h3>
        <p className="text-[12px] text-muted-foreground mb-4">Default: pichla Monday – Sunday. Commission har completed order ke snapshot se aata hai (free/coin orders = ₹0).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-[12px] text-muted-foreground">Area partner
            <select className={`${input} w-full mt-1`} value={partnerId} disabled={!!editing} onChange={(e) => { setPartnerId(e.target.value); setOrders(null); }}>
              <option value="">Select…</option>
              {opts?.partners.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (inactive)"}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted-foreground">From
            <input type="date" className={`${input} w-full mt-1`} value={start} max={end} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="text-[12px] text-muted-foreground">To
            <input type="date" className={`${input} w-full mt-1`} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <div className="flex items-end gap-2">
            <button className={`${btn} bg-primary text-primary-foreground flex-1`} disabled={busy} onClick={() => generate()}>{busy ? "Loading…" : "Generate"}</button>
            {editing && <button className={`${btn} border border-border`} onClick={() => { setEditing(null); setOrders(null); }}>Cancel</button>}
          </div>
        </div>
        {!!opts?.services.length && (
          <div className="mt-3">
            <p className="text-[12px] text-muted-foreground mb-1">Services {services.length ? `(${services.length})` : "(sab)"}</p>
            <div className="flex flex-wrap gap-2">
              {opts.services.map((s) => {
                const on = services.includes(s);
                return (
                  <button key={s} onClick={() => setServices(on ? services.filter((x) => x !== s) : [...services, s])}
                    className={`px-3 py-1.5 rounded-full text-[12px] border ${on ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground"}`}>{s}</button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {orders && (
        <div className="bg-card border border-border rounded-[18px] p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Mini label="Orders found" value={String(orders.length)} />
            <Mini label="Selected" value={String(selected.length)} />
            <Mini label="Order value" value={inr(selected.reduce((s, o) => s + o.amount, 0))} />
            <Mini label="Commission" value={inr(total)} strong />
          </div>
          <div className="overflow-x-auto board-swipe">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border">
                <th className="py-2 pr-2">Include</th><th>Order</th><th>Completed</th><th>Service</th><th>Zone</th><th className="text-right">Amount</th><th className="text-right">Commission</th>
              </tr></thead>
              <tbody>
                {orders.map((o) => {
                  const inc = !o.locked && !excluded.has(o.id);
                  return (
                    <tr key={o.id} className={`border-b border-border ${inc ? "" : "opacity-50"}`}>
                      <td className="py-2 pr-2">
                        {o.locked ? <span className="text-[11px] text-muted-foreground">Already saved</span> : (
                          <button className="text-[12px] font-semibold text-primary" onClick={() => { const n = new Set(excluded); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); setExcluded(n); }}>{inc ? "Remove" : "Add back"}</button>
                        )}
                      </td>
                      <td className="font-mono">#{o.id.slice(0, 8)}</td>
                      <td>{fmt(o.completed_at)}</td>
                      <td>{o.service_label}</td>
                      <td>{o.zone_name}</td>
                      <td className="text-right">{inr(o.amount)}</td>
                      <td className="text-right font-semibold">{inr(o.commission)}</td>
                    </tr>
                  );
                })}
                {!orders.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Is range me koi completed order nahi mila.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <input className={`${input} flex-1`} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button className={`${btn} border border-border`} disabled={!selected.length} onClick={() => downloadPdf(fileName, partnerName, start, end, selected, "draft")}>PDF</button>
            <button className={`${btn} border border-border`} disabled={!selected.length} onClick={() => downloadCsv(fileName, partnerName, start, end, selected)}>Excel</button>
            <button className={`${btn} bg-primary text-primary-foreground`} disabled={busy || !selected.length} onClick={save}>{editing ? "Update commission" : "Save final commission"}</button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-[18px] p-4 sm:p-6">
        <h3 className="text-[15px] font-bold text-foreground mb-4">Saved commission batches</h3>
        <div className="overflow-x-auto board-swipe">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead><tr className="text-left text-[11px] uppercase text-muted-foreground border-b border-border">
              <th className="py-2">Partner</th><th>Period</th><th>Orders</th><th className="text-right">Commission</th><th>Status</th><th>Payment</th><th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className={`border-b border-border ${b.status === "discarded" ? "opacity-50" : ""}`}>
                  <td className="py-2">{b.partner_name}</td>
                  <td>{fmt(b.week_start)} – {fmt(b.week_end)}</td>
                  <td>{b.booking_ids.length}</td>
                  <td className="text-right font-semibold">{inr(b.total_amount)}</td>
                  <td className="uppercase text-[11px] font-bold">{b.status === "discarded" ? "deleted" : b.status}</td>
                  <td className="text-[12px]">{b.paid ? `${b.paid_on ? fmt(b.paid_on) : ""} ${b.payment_mode ?? ""} ${b.utr ?? ""}` : "—"}</td>
                  <td className="text-right whitespace-nowrap space-x-2 text-[12px] font-semibold">
                    {b.status !== "discarded" && <>
                      <button className="text-primary" onClick={() => exportBatch(b, "pdf")}>PDF</button>
                      <button className="text-primary" onClick={() => exportBatch(b, "csv")}>Excel</button>
                    </>}
                    {b.status === "pending" && <>
                      <button className="text-primary" onClick={() => startEdit(b)}>Edit</button>
                      <button className="text-primary" onClick={() => act(b, "paid")}>Mark paid</button>
                      <button className="text-destructive" onClick={() => act(b, "discard")}>Delete</button>
                    </>}
                    {b.status === "paid" && <button className="text-primary" onClick={() => act(b, "unpaid")}>Unmark</button>}
                  </td>
                </tr>
              ))}
              {!batches.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Abhi koi batch save nahi hai.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-[12px] border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-[16px] ${strong ? "font-bold text-primary" : "font-semibold text-foreground"}`}>{value}</p>
    </div>
  );
}
