import { useState } from "react";
import { formatPhone } from "@/lib/phone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }) : "—");
const inr = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const WORK: Record<string, string> = { maid: "Maid", washer: "Washer", rider: "Rider" };

type ApApp = {
  id: string; name: string | null; phone: string | null; zone_name: string | null; work_types: string[]; status: string;
  submitted_at: string | null; created_at: string; missing: string[]; recommended_at: string | null; recommend_note: string | null;
};

/** Area Partner: applications from their zones; they can only recommend. */
export function ApApplicationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("submitted");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({
    queryKey: ["ap-apps", status],
    queryFn: async () => { const { data, error } = await db.rpc("ap_list_expert_applications", { _status: status || null }); if (error) throw error; return data as ApApp[]; },
  });
  async function recommend(id: string) {
    const { error } = await db.rpc("staff_recommend_application", { _id: id, _note: note.trim() || null });
    if (error) return toast.error(error.message);
    toast.success("Recommended — badiyos team will review");
    setNoteFor(null); setNote("");
    qc.invalidateQueries({ queryKey: ["ap-apps"] });
  }
  return (
    <div className="space-y-3">
      <select aria-label="Status" className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="submitted">Submitted</option><option value="query_raised">Query raised</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option>
      </select>
      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      <div className="rounded-[14px] border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="p-3">Applicant</th><th className="p-3">Work type</th><th className="p-3">Submitted</th><th className="p-3">Missing</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={6} className="p-4 text-muted-foreground">Loading…</td></tr>}
            {!q.isLoading && !(q.data ?? []).length && <tr><td colSpan={6} className="p-4 text-muted-foreground">No applications in your zones.</td></tr>}
            {(q.data ?? []).map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0 align-top">
                <td className="p-3 font-semibold">{a.name || "—"}<div className="text-[11px] font-normal text-muted-foreground">{(formatPhone(a.phone) || "—")} · {a.zone_name ?? "—"}</div></td>
                <td className="p-3">{a.work_types.map((w) => WORK[w] ?? w).join(", ")}</td>
                <td className="p-3">{dt(a.submitted_at)}</td>
                <td className="p-3 text-[12px]">{a.missing.length ? a.missing.join(", ") : "Nothing"}</td>
                <td className="p-3 capitalize">{a.status.replace("_", " ")}</td>
                <td className="p-3 min-w-[200px]">
                  {a.recommended_at ? (
                    <span className="text-[12px] font-semibold text-primary">Recommended {dt(a.recommended_at)}{a.recommend_note ? ` — ${a.recommend_note}` : ""}</span>
                  ) : (a.status === "submitted" || a.status === "query_raised") ? (
                    noteFor === a.id ? (
                      <div className="space-y-1">
                        <input aria-label="Note" className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px]" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                        <div className="flex gap-1"><Button size="sm" onClick={() => recommend(a.id)}>Recommend</Button><Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>Cancel</Button></div>
                      </div>
                    ) : <Button size="sm" variant="outline" onClick={() => { setNoteFor(a.id); setNote(""); }}>Recommend</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Earnings = {
  partner: null | { name: string; program: string | null; level: string | null; agreement_start: string | null; agreement_end: string | null; fee_paid: number | null; status: string | null };
  statements?: { batch_id: string; period_start: string; period_end: string; status: string; paid_on: string | null; orders: number; amount: number }[];
  payments?: { type: string; amount: number; gst_amount: number | null; paid_on: string | null; mode: string | null; reference: string | null }[];
  agreements?: { id: string; title: string; status: string; accepted_at: string | null; version: number }[];
};

/** Area Partner: read-only royalty statements, fees/deposit and agreement. */
export function ApEarningsPage() {
  const q = useQuery({ queryKey: ["ap-earnings"], queryFn: async () => { const { data, error } = await db.rpc("ap_my_earnings"); if (error) throw error; return data as Earnings; } });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const e = q.data!;
  if (!e.partner) return <p className="text-sm text-muted-foreground">Your login is not linked to a partner profile yet. Ask badiyos to link it.</p>;
  const p = e.partner;
  const card = "rounded-[14px] border border-border bg-card p-4";
  return (
    <div className="space-y-4 max-w-4xl">
      <div className={card}>
        <p className="text-[16px] font-bold text-foreground">{p.name}</p>
        <p className="text-[13px] text-muted-foreground">{[p.program, p.level, p.status].filter(Boolean).join(" · ")}</p>
        <p className="text-[13px] text-foreground mt-1">Agreement: {dt(p.agreement_start)} – {dt(p.agreement_end)} · Fee paid: {inr(p.fee_paid)}</p>
      </div>
      <section className={card}>
        <h3 className="text-[13px] font-bold uppercase text-muted-foreground mb-2">Payout statements</h3>
        {!e.statements?.length ? <p className="text-[13px] text-muted-foreground">No statements yet.</p> : (
          <table className="w-full text-[13px]"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Period</th><th>Orders</th><th>Amount</th><th>Status</th><th>Paid on</th></tr></thead>
            <tbody>{e.statements.map((s) => <tr key={s.batch_id} className="border-t border-border"><td className="py-1.5">{dt(s.period_start)} – {dt(s.period_end)}</td><td>{s.orders}</td><td className="font-semibold">{inr(s.amount)}</td><td className="capitalize">{s.status}</td><td>{dt(s.paid_on)}</td></tr>)}</tbody></table>
        )}
      </section>
      <section className={card}>
        <h3 className="text-[13px] font-bold uppercase text-muted-foreground mb-2">Fees & deposit</h3>
        {!e.payments?.length ? <p className="text-[13px] text-muted-foreground">No payments recorded.</p> : (
          <table className="w-full text-[13px]"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Type</th><th>Amount</th><th>GST</th><th>Paid on</th><th>Mode</th></tr></thead>
            <tbody>{e.payments.map((x, i) => <tr key={i} className="border-t border-border"><td className="py-1.5 capitalize">{x.type.replace(/_/g, " ")}</td><td className="font-semibold">{inr(x.amount)}</td><td>{inr(x.gst_amount)}</td><td>{dt(x.paid_on)}</td><td>{x.mode ?? "—"}</td></tr>)}</tbody></table>
        )}
      </section>
      <section className={card}>
        <h3 className="text-[13px] font-bold uppercase text-muted-foreground mb-2">Agreement</h3>
        {!e.agreements?.length ? <p className="text-[13px] text-muted-foreground">No agreement issued yet.</p> :
          e.agreements.map((g) => <p key={g.id} className="text-[13px]">{g.title} · v{g.version} · {g.status === "accepted" ? `Signed ${dt(g.accepted_at)}` : "Not signed"}</p>)}
      </section>
    </div>
  );
}
