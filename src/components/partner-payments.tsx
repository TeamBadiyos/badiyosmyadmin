import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const err = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));
const inr = (n: unknown) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export const PAY_TYPE: Record<string, string> = { franchise_fee: "Franchise / joining fee", security_deposit: "Security deposit", renewal_fee: "Renewal fee", other: "Other" };
const MODE: Record<string, string> = { bank: "Bank", upi: "UPI", cash: "Cash" };

export type PartnerPay = { id: string; partner_id: string; partner_name?: string; type: string; amount: number; gst_pct: number; gst_amount: number; paid_on: string; mode: string; reference: string | null; receipt_path: string | null; note: string | null };

const openReceipt = async (p: string) => { const { data, error } = await supabase.storage.from("partner-receipts").createSignedUrl(p, 300); if (error) return toast.error(err(error)); window.open(data.signedUrl, "_blank"); };

export function useFranchiseGstPct() {
  return useQuery({ queryKey: ["tax", "franchise_fee_gst"], queryFn: async () => { const { data } = await db.from("tax_settings").select("rate_pct,is_active").eq("key", "franchise_fee_gst").maybeSingle(); return data?.is_active ? Number(data.rate_pct) : 0; } });
}

export function PartnerPaymentsPanel({ partnerId, canEdit }: { partnerId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["partner-payments", partnerId];
  const q = useQuery({ queryKey: key, queryFn: async () => { const { data, error } = await db.from("partner_payments").select("*").eq("partner_id", partnerId).order("paid_on", { ascending: false }); if (error) throw error; return data as PartnerPay[]; } });
  const gst = useFranchiseGstPct();
  const [f, setF] = useState<{ type: string; amount: string; paid_on: string; mode: string; reference: string; note: string; refund: boolean; file: File | null } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const amt = Number(f!.amount);
      if (!(amt > 0)) throw new Error("Enter an amount");
      let path: string | null = null;
      if (f!.file) {
        if (f!.file.size > 10 * 1024 * 1024) throw new Error("Receipt is larger than 10 MB");
        path = `${partnerId}/${Date.now()}.${(f!.file.name.split(".").pop() || "jpg").toLowerCase()}`;
        const up = await supabase.storage.from("partner-receipts").upload(path, f!.file, { contentType: f!.file.type }); if (up.error) throw up.error;
      }
      const { error } = await db.rpc("staff_add_partner_payment", { _partner_id: partnerId, _type: f!.type, _amount: f!.type === "security_deposit" && f!.refund ? -amt : amt, _paid_on: f!.paid_on, _mode: f!.mode, _reference: f!.reference, _receipt_path: path, _note: f!.note });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Payment recorded"); setF(null); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["fin-partner-fees"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const rows = q.data ?? [];
  const fees = rows.filter((r) => r.type !== "security_deposit").reduce((a, r) => a + Number(r.amount), 0);
  const held = rows.filter((r) => r.type === "security_deposit").reduce((a, r) => a + Number(r.amount), 0);
  const isFee = f && f.type !== "security_deposit";
  const amt = Number(f?.amount || 0);
  const inp = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Fees received (excl GST)</div><div className="font-bold">{inr(fees)}</div></div>
        <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Deposit held</div><div className="font-bold">{inr(held)}</div></div>
      </div>
      {canEdit && !f && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setF({ type: "franchise_fee", amount: "", paid_on: istToday(), mode: "bank", reference: "", note: "", refund: false, file: null })}>Add payment</Button>
          <Button size="sm" variant="outline" onClick={() => setF({ type: "security_deposit", amount: "", paid_on: istToday(), mode: "bank", reference: "", note: "", refund: true, file: null })}>Refund deposit</Button>
        </div>
      )}
      {f && (
        <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <label>Type<select className={inp} value={f.type} disabled={f.refund} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(PAY_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>{f.refund ? "Refund amount (₹)" : "Amount (₹, excl GST)"}<input type="number" min={0} step="0.01" className={inp} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
            <label>Date<input type="date" className={inp} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></label>
            <label>Mode<select className={inp} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{Object.entries(MODE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Reference / UTR<input className={inp} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
            <label>Receipt photo<input type="file" accept="image/*,application/pdf" className="block w-full text-xs mt-2" onChange={(e) => setF({ ...f, file: e.target.files?.[0] ?? null })} /></label>
          </div>
          <label className="block">Note<input className={inp} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          <p className="text-xs text-muted-foreground">
            {isFee ? <>GST {gst.data ?? 0}% = {inr(Math.round(amt * (gst.data ?? 0)) / 100)} · total {inr(amt + Math.round(amt * (gst.data ?? 0)) / 100)}. Booked as Other Income – Franchise Fee.</> : f.refund ? "Saved as a negative deposit entry. No GST." : "Held as Partner deposits (liability), never income. No GST."}
          </p>
          <div className="flex gap-2 justify-end"><Button size="sm" variant="ghost" onClick={() => setF(null)}>Cancel</Button><Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></div>
        </div>
      )}
      {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
      <PaymentsTable rows={rows} />
    </div>
  );
}

function PaymentsTable({ rows, showPartner, onPartner }: { rows: PartnerPay[]; showPartner?: boolean; onPartner?: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground"><tr>
          <th className="p-2">Date</th>{showPartner && <th className="p-2">Partner</th>}<th className="p-2">Type</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">GST</th><th className="p-2">Mode</th><th className="p-2">Reference</th><th className="p-2" />
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="p-3 text-center text-muted-foreground">No payments yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="p-2 whitespace-nowrap">{fmt(r.paid_on)}</td>
              {showPartner && <td className="p-2">{onPartner ? <button className="text-primary font-semibold" onClick={() => onPartner(r.partner_id)}>{r.partner_name}</button> : r.partner_name}</td>}
              <td className="p-2">{Number(r.amount) < 0 ? "Deposit refund" : PAY_TYPE[r.type]}{r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}</td>
              <td className={`p-2 text-right ${Number(r.amount) < 0 ? "text-destructive" : ""}`}>{inr(r.amount)}</td>
              <td className="p-2 text-right">{r.type === "security_deposit" ? "—" : `${inr(r.gst_amount)} (${r.gst_pct}%)`}</td>
              <td className="p-2">{MODE[r.mode]}</td>
              <td className="p-2">{r.reference ?? "—"}</td>
              <td className="p-2">{r.receipt_path && <button className="text-primary text-xs" onClick={() => openReceipt(r.receipt_path!)}>Receipt</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type PartnerFees = { rows: PartnerPay[]; fee_income: number; fee_gst: number; deposits_in: number; deposits_refunded: number; deposits_held: number };
export async function fetchPartnerFees(from: string, to: string): Promise<PartnerFees> {
  const { data, error } = await db.rpc("fin_partner_fees", { _from: from, _to: to });
  if (error) throw new Error(error.message);
  return data as PartnerFees;
}

/** Finance → Collections → "Partner fees" chip (read-only). */
export function PartnerFeesCollections({ onPartner }: { onPartner?: (id: string) => void }) {
  const to = istToday();
  const [from, setFrom] = useState(to.slice(0, 7) + "-01");
  const [toD, setTo] = useState(to);
  const q = useQuery({ queryKey: ["fin-partner-fees", from, toD], queryFn: () => fetchPartnerFees(from, toD) });
  const d = q.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>From<input type="date" className="block h-9 rounded-md border border-input bg-background px-2" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To<input type="date" className="block h-9 rounded-md border border-input bg-background px-2" value={toD} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {q.isError && <p className="text-sm text-destructive">{err(q.error)}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
        {[["Fee income (excl GST)", d?.fee_income], ["GST on fees", d?.fee_gst], ["Deposits received", d?.deposits_in], ["Deposits refunded", d?.deposits_refunded], ["Deposits held (all time)", d?.deposits_held]].map(([l, v]) => (
          <div key={String(l)} className="rounded-lg border border-border bg-card p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="font-bold">{q.isLoading ? "…" : inr(v)}</div></div>
        ))}
      </div>
      <PaymentsTable rows={d?.rows ?? []} showPartner onPartner={onPartner} />
    </div>
  );
}
