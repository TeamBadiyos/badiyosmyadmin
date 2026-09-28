import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Plus, Search } from "lucide-react";
import {
  assignSealBatch, createSealBatch, exportSealBatch, getSealStock, listDeliveryMerchants,
  listSealBatches, lookupSeal, reassignSealBatch, voidSeal, type SealBatch,
} from "@/lib/bulk-courier.functions";
import { Field, Modal, Pill, inputCls } from "@/components/courier-page";
import {
  generateSealStickerPdf,
  sealPdfFilename,
  type SealLabelColour,
} from "@/lib/seal-sticker-pdf";

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

type PdfDialogState = {
  batch: SealBatch;
  from: string;
  to: string;
  colour: SealLabelColour;
};

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
  const [pdfDialog, setPdfDialog] = useState<PdfDialogState | null>(null);
  const [pdfProgress, setPdfProgress] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [assignErr, setAssignErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: merchants } = useQuery({ queryKey: ["bulk", "delivery-merchants"], queryFn: () => merchantsFn(), enabled: !!assigning });

  const from = Number(creating?.from), to = Number(creating?.to);
  const previewCount = creating && Number.isInteger(from) && Number.isInteger(to) && to >= from && from > 0 ? to - from + 1 : 0;
  const picked = merchants?.find((m) => m.id === assigning?.merchant);
  const pdfFrom = Number(pdfDialog?.from);
  const pdfTo = Number(pdfDialog?.to);
  const pdfCount = pdfDialog && Number.isInteger(pdfFrom) && Number.isInteger(pdfTo) && pdfTo >= pdfFrom ? pdfTo - pdfFrom + 1 : 0;
  const pdfRangeValid = !!pdfDialog && pdfCount > 0 && pdfCount <= 5000 && pdfFrom >= pdfDialog.batch.serial_from && pdfTo <= pdfDialog.batch.serial_to;

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

  const downloadPdf = async () => {
    if (!pdfDialog || !pdfRangeValid) return;
    setPdfProgress(0);
    setPdfError(null);
    try {
      const rows = await exp({ data: { batch_id: pdfDialog.batch.id } });
      const selected = rows.filter((row) => row.serial >= pdfFrom && row.serial <= pdfTo);
      if (selected.length !== pdfCount) throw new Error(`Only ${selected.length.toLocaleString("en-IN")} of ${pdfCount.toLocaleString("en-IN")} selected stickers were returned.`);
      const blob = await generateSealStickerPdf({
        batchNo: pdfDialog.batch.batch_no,
        from: pdfFrom,
        to: pdfTo,
        colour: pdfDialog.colour,
        rows: selected,
        onProgress: (completed, total) => setPdfProgress(Math.round((completed / total) * 100)),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = sealPdfFilename({ batchNo: pdfDialog.batch.batch_no, from: pdfFrom, to: pdfTo, colour: pdfDialog.colour });
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${pdfCount.toLocaleString("en-IN")} sticker PDF ready`);
      setPdfDialog(null);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Could not generate PDF");
    } finally {
      setPdfProgress(null);
    }
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
                  <button className={`${btnGhost} mr-2`} onClick={() => download(b)}>Export CSV</button>
                  <button className={btnGhost} onClick={() => { setPdfError(null); setPdfDialog({ batch: b, from: String(b.serial_from), to: String(b.serial_to), colour: "green" }); }}><Download size={13} className="mr-1 inline" />Download PDF</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && (data?.batches ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">No batches yet.</p> : null}

      {pdfDialog ? (
        <Modal title={`Download batch #${pdfDialog.batch.batch_no} PDF`} onClose={() => { if (pdfProgress == null) setPdfDialog(null); }}>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[12px] font-semibold text-foreground">Serial range</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><input type="number" min={pdfDialog.batch.serial_from} max={pdfDialog.batch.serial_to} className={inputCls} disabled={pdfProgress != null} value={pdfDialog.from} onChange={(e) => { setPdfError(null); setPdfDialog({ ...pdfDialog, from: e.target.value }); }} /></Field>
                <Field label="To"><input type="number" min={pdfDialog.batch.serial_from} max={pdfDialog.batch.serial_to} className={inputCls} disabled={pdfProgress != null} value={pdfDialog.to} onChange={(e) => { setPdfError(null); setPdfDialog({ ...pdfDialog, to: e.target.value }); }} /></Field>
              </div>
              <p className={`mt-1 text-[11px] ${pdfRangeValid ? "text-muted-foreground" : "text-destructive"}`}>
                {pdfCount > 5000 ? "Maximum 5,000 stickers per PDF." : pdfFrom < pdfDialog.batch.serial_from || pdfTo > pdfDialog.batch.serial_to ? `Range must stay within ${pdfDialog.batch.serial_from}–${pdfDialog.batch.serial_to}.` : pdfCount > 0 ? `${pdfCount.toLocaleString("en-IN")} stickers selected (maximum 5,000).` : "Enter a valid range within this batch."}
              </p>
            </div>
            <Field label="Label size">
              <p className="text-[12px] text-muted-foreground">4 × 11.5 inch fold-over seal — one sticker per page.</p>
            </Field>
            <Field label="Colour">
              <div className="grid grid-cols-2 gap-2">
                {(["green", "black"] as const).map((colour) => <button key={colour} type="button" disabled={pdfProgress != null} className={`${btnGhost} py-2 capitalize ${pdfDialog.colour === colour ? "border-primary bg-primary-tint text-primary" : ""}`} onClick={() => setPdfDialog({ ...pdfDialog, colour })}><span className={`mr-2 inline-block size-2.5 rounded-full ${colour === "green" ? "bg-primary" : "bg-secondary"}`} />{colour}</button>)}
              </div>
            </Field>
            {pdfProgress != null ? (
              <div className="space-y-1" aria-live="polite">
                <div className="flex justify-between text-[11px] font-semibold text-foreground"><span>Generating PDF</span><span>{pdfProgress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pdfProgress}%` }} /></div>
              </div>
            ) : null}
            {pdfError ? <div className="rounded-[10px] border border-destructive/40 bg-destructive/10 p-3 text-[13px] font-semibold text-destructive">{pdfError}</div> : null}
            <div className="flex justify-end gap-2">
              <button className={btnGhost} disabled={pdfProgress != null} onClick={() => setPdfDialog(null)}>Cancel</button>
              <button className={btn} disabled={!pdfRangeValid || pdfProgress != null} onClick={downloadPdf}><Download size={14} className="mr-1 inline" />{pdfProgress == null ? "Download PDF" : "Generating…"}</button>
            </div>
          </div>
        </Modal>
      ) : null}

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
