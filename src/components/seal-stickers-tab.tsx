import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import {
  assignSealBatch, createSealBatch, exportSealBatch, getSealStock, listDeliveryMerchants,
  listSealBatches, lookupSeal, voidSeal, type SealBatch,
} from "@/lib/bulk-courier.functions";
import { Field, Modal, Pill, inputCls } from "@/components/courier-page";

const btn = "rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-40";
const btnGhost = "rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-40";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground";
const td = "px-3 py-2 text-[13px] text-foreground";
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const PICKED = ["picked_up", "in_transit", "out_for_delivery", "delivered", "failed", "returned"];

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function SealStockCard({ merchantId }: { merchantId: string }) {
  const fn = useServerFn(getSealStock);
  const { data, error } = useQuery({ queryKey: ["bulk", "seal-stock", merchantId], queryFn: () => fn({ data: { merchant_id: merchantId } }) });
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-foreground">Stickers {data?.low ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">Low stock</span> : null}</div>
      {error ? <p className="text-[12px] text-destructive">{(error as Error).message}</p> : !data ? <p className="text-[12px] text-muted-foreground">Loading…</p> : (
        <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          <div><div className="text-[11px] text-muted-foreground">Available</div><div className="font-bold">{data.available}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Used today</div><div className="font-bold">{data.usedToday}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Avg / day (7d)</div><div className="font-bold">{data.avgPerDay}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Days of stock left</div><div className={`font-bold ${data.low ? "text-destructive" : ""}`}>{data.daysLeft == null ? "—" : data.daysLeft.toFixed(1)}</div></div>
        </div>
      )}
    </div>
  );
}

function Lookup({ canVoid }: { canVoid: boolean }) {
  const qc = useQueryClient();
  const lookup = useServerFn(lookupSeal);
  const doVoid = useServerFn(voidSeal);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setRes(await lookup({ data: { q } })); } catch (e) { err(e); } finally { setBusy(false); }
  };
  const picked = !!res?.ok && (res.status === "void" || PICKED.includes(String(res.order?.status ?? "")));
  return (
    <div className="space-y-2 rounded-[14px] border border-border bg-card p-4">
      <div className="text-[13px] font-bold">Sticker lookup</div>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="BDY1045217 / 1045217 / 104521-7" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className={btn} disabled={busy || !q.trim()} onClick={search}><Search size={14} /></button>
      </div>
      {res ? (res.ok === false ? (
        <p className="text-[13px] text-destructive">{res.error === "NOT_FOUND" ? `No sticker found for ${res.code}` : "Invalid sticker number"}</p>
      ) : (
        <div className="space-y-1 text-[13px]">
          <div className="flex items-center gap-2 font-semibold">{res.printed_text ?? res.code} <Pill tone={res.status === "available" ? "ok" : res.status === "void" ? "warn" : "off"}>{res.status}</Pill></div>
          <div>Business: {res.business?.name ?? "Unassigned"}</div>
          <div>Batch: {res.batch ? `#${res.batch.batch_no}` : "—"}</div>
          <div>Order: {res.order ? `${res.order.display_no} · ${res.order.receiver_name ?? "—"} · ${res.order.status}` : "Not linked"}</div>
          {res.void_reason ? <div className="text-destructive">Void reason: {res.void_reason}</div> : null}
          {canVoid ? <button className={btnGhost} disabled={picked} onClick={() => { setReason(""); setVoiding(true); }}>Void</button> : null}
          {canVoid && picked && res.status !== "void" ? <p className="text-[11px] text-muted-foreground">Can't void once picked up.</p> : null}
        </div>
      )) : null}
      {voiding && res?.code ? (
        <Modal title={`Void ${res.printed_text ?? res.code}?`} onClose={() => setVoiding(false)}>
          <div className="space-y-3">
            <Field label="Reason (required)"><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setVoiding(false)}>Cancel</button>
              <button className={btn} disabled={!reason.trim() || busy} onClick={async () => {
                setBusy(true);
                try { await doVoid({ data: { code: res.code, reason } }); toast.success("Sticker voided"); setVoiding(false); setRes(await lookup({ data: { q: res.code } })); qc.invalidateQueries({ queryKey: ["bulk"] }); } catch (e) { err(e); } finally { setBusy(false); }
              }}>Void sticker</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function SealStickersTab({ canWrite, canVoid }: { canWrite: boolean; canVoid: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listSealBatches);
  const merchantsFn = useServerFn(listDeliveryMerchants);
  const create = useServerFn(createSealBatch);
  const assign = useServerFn(assignSealBatch);
  const exp = useServerFn(exportSealBatch);
  const { data, isLoading, error } = useQuery({ queryKey: ["bulk", "seal-batches"], queryFn: () => list() });
  const [creating, setCreating] = useState<{ from: string; to: string; notes: string } | null>(null);
  const [assigning, setAssigning] = useState<{ batch: SealBatch; merchant: string; charge: string } | null>(null);
  const [assignErr, setAssignErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: merchants } = useQuery({ queryKey: ["bulk", "delivery-merchants"], queryFn: () => merchantsFn(), enabled: !!assigning });

  const from = Number(creating?.from), to = Number(creating?.to);
  const previewCount = creating && Number.isInteger(from) && Number.isInteger(to) && to >= from && from > 0 ? to - from + 1 : 0;
  const picked = merchants?.find((m) => m.id === assigning?.merchant);

  const download = async (b: SealBatch) => {
    try {
      const rows = await exp({ data: { batch_id: b.id } });
      const csv = ["serial,code,qr_payload,printed_text", ...rows.map((r) => [r.serial, r.code, r.qr_payload, r.printed_text].map(csvCell).join(","))].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = `badiyos-seal-batch-${b.batch_no}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { err(e); }
  };

  return (
    <div className="space-y-4">
      <Lookup canVoid={canVoid} />
      {canWrite ? <button className={btn} onClick={() => setCreating({ from: String(data?.nextSerial ?? ""), to: "", notes: "" })}><Plus size={14} className="mr-1 inline" />Create Batch</button> : null}
      {isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-[13px] text-destructive">{(error as Error).message}</p> : null}
      <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/40"><tr>{["Batch #", "Serial range", "Total", "Business", "Available", "Used", "Void", "Created", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {(data?.batches ?? []).map((b) => (
              <tr key={b.id}>
                <td className={`${td} font-semibold`}>#{b.batch_no}</td>
                <td className={td}>{b.serial_from} – {b.serial_to}</td>
                <td className={td}>{b.total}</td>
                <td className={td}>{b.business ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                <td className={td}>{b.available}</td><td className={td}>{b.used}</td><td className={td}>{b.void}</td>
                <td className={td}>{new Date(b.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                <td className={`${td} whitespace-nowrap`}>
                  {canWrite && !b.merchant_id ? <button className={`${btnGhost} mr-2`} onClick={() => { setAssignErr(null); setAssigning({ batch: b, merchant: "", charge: "" }); }}>Assign</button> : null}
                  <button className={btnGhost} onClick={() => download(b)}>Export CSV</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && (data?.batches ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">No batches yet.</p> : null}

      {creating ? (
        <Modal title="Create sticker batch" onClose={() => setCreating(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Serial From"><input type="number" className={inputCls} value={creating.from} onChange={(e) => setCreating({ ...creating, from: e.target.value })} /></Field>
              <Field label="Serial To"><input type="number" className={inputCls} value={creating.to} onChange={(e) => setCreating({ ...creating, to: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><input className={inputCls} value={creating.notes} onChange={(e) => setCreating({ ...creating, notes: e.target.value })} /></Field>
            <p className="text-[13px] text-foreground">{previewCount ? `This will create ${previewCount.toLocaleString("en-IN")} stickers.` : "Enter a valid range."}</p>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setCreating(null)}>Cancel</button>
              <button className={btn} disabled={!previewCount || busy} onClick={async () => {
                setBusy(true);
                try { await create({ data: { from, to, notes: creating.notes } }); toast.success("Batch created"); setCreating(null); qc.invalidateQueries({ queryKey: ["bulk", "seal-batches"] }); } catch (e) { err(e); } finally { setBusy(false); }
              }}>Create</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {assigning ? (
        <Modal title={`Assign batch #${assigning.batch.batch_no}`} onClose={() => setAssigning(null)}>
          <div className="space-y-3">
            <Field label="Business">
              <select className={inputCls} value={assigning.merchant} onChange={(e) => { setAssignErr(null); setAssigning({ ...assigning, merchant: e.target.value }); }}>
                <option value="">Select business</option>
                {(merchants ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Sticker charge ₹ (optional, debited from delivery wallet)">
              <input type="number" min={0} className={inputCls} value={assigning.charge} onChange={(e) => { setAssignErr(null); setAssigning({ ...assigning, charge: e.target.value }); }} />
            </Field>
            {picked ? <p className={`text-[12px] ${picked.balance < Number(assigning.charge || 0) ? "text-destructive" : "text-muted-foreground"}`}>Delivery wallet balance: {inr(picked.balance)}</p> : null}
            {assignErr ? <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 p-3 text-[13px] font-semibold text-destructive">{assignErr}</div> : null}
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setAssigning(null)}>Cancel</button>
              <button className={btn} disabled={!assigning.merchant || busy} onClick={async () => {
                setBusy(true);
                try {
                  await assign({ data: { batch_id: assigning.batch.id, merchant_id: assigning.merchant, charge: assigning.charge ? Number(assigning.charge) : null } });
                  toast.success("Batch assigned"); setAssigning(null); qc.invalidateQueries({ queryKey: ["bulk"] });
                } catch (e) { setAssignErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
              }}>Assign</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
