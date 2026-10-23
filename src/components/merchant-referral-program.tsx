import { useEffect, useState } from "react";
import { formatPhone } from "@/lib/phone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import {
  listMerchantReferrals, saveMerchantReferralConfig, markMerchantReferralEarned, reverseMerchantReferral,
  type MerchantReferralRow,
} from "@/lib/merchant-referrals.functions";

const inputCls = "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");

const STATUS: Record<string, [string, string]> = {
  in_progress: ["In progress", "bg-warning/15 text-warning"],
  earned: ["Reward earned", "bg-primary-tint text-primary"],
  expired: ["Expired", "bg-muted text-muted-foreground"],
  reversed: ["Reversed", "bg-destructive/10 text-destructive"],
};

export function MerchantReferralProgram({ isSuper }: { isSuper: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listMerchantReferrals);
  const saveFn = useServerFn(saveMerchantReferralConfig);
  const earnFn = useServerFn(markMerchantReferralEarned);
  const revFn = useServerFn(reverseMerchantReferral);
  const q = useQuery({ queryKey: ["merchant-referrals"], queryFn: () => listFn() });
  const cfg = q.data?.config;
  const rows = q.data?.rows ?? [];

  const [form, setForm] = useState({ reward: 500, target: 20, days: 60, active: true });
  useEffect(() => {
    if (cfg) setForm({ reward: Number(cfg.reward_amount), target: cfg.target_orders, days: cfg.window_days, active: cfg.is_active });
  }, [cfg]);
  const [reversing, setReversing] = useState<MerchantReferralRow | null>(null);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");

  const done = (msg: string) => () => { qc.invalidateQueries({ queryKey: ["merchant-referrals"] }); toast.success(msg); };
  const save = useMutation({ mutationFn: () => saveFn({ data: form }), onSuccess: done("Settings saved"), onError: (e: Error) => toast.error(e.message) });
  const earn = useMutation({ mutationFn: (id: string) => earnFn({ data: { id } }), onSuccess: done("Marked earned — added to ledger"), onError: (e: Error) => toast.error(e.message) });
  const rev = useMutation({
    mutationFn: () => revFn({ data: { id: reversing!.id, reason } }),
    onSuccess: () => { setReversing(null); setReason(""); done("Reward reversed")(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const shown = status ? rows.filter((r) => r.status === status) : rows;
  const earnedRows = rows.filter((r) => r.status === "earned");

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-[18px] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Merchant referral</p>
            <p className="text-[12px] text-muted-foreground">
              Referring store gets {inr(form.reward)} when the referred store completes {form.target} delivered orders within {form.days} days of going Live. Paid in their next settlement.
            </p>
          </div>
          <button
            disabled={!isSuper}
            onClick={() => setForm({ ...form, active: !form.active })}
            className={`h-8 px-3 rounded-full text-[11px] font-bold uppercase tracking-wide ${form.active ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {form.active ? "On" : "Off"}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5"><span className={labelCls}>Reward amount (₹)</span>
            <input type="number" min={0} disabled={!isSuper} className={inputCls} value={form.reward} onChange={(e) => setForm({ ...form, reward: Number(e.target.value) })} /></label>
          <label className="space-y-1.5"><span className={labelCls}>Delivered orders needed</span>
            <input type="number" min={1} disabled={!isSuper} className={inputCls} value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} /></label>
          <label className="space-y-1.5"><span className={labelCls}>Within days of going Live</span>
            <input type="number" min={1} disabled={!isSuper} className={inputCls} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} /></label>
        </div>
        {isSuper && (
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">Changes apply to new referrals; existing ones keep their terms.</p>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-60">Save settings</button>
          </div>
        )}
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[
          ["Referred stores", rows.length],
          ["In progress", rows.filter((r) => r.status === "in_progress").length],
          ["Rewards earned", `${earnedRows.length} · ${inr(earnedRows.reduce((s, r) => s + Number(r.reward_amount), 0))}`],
          ["Expired / reversed", rows.filter((r) => r.status === "expired" || r.status === "reversed").length],
        ].map(([l, v]) => (
          <div key={String(l)} className="bg-card border border-border rounded-[14px] px-4 py-3">
            <p className={labelCls}>{l}</p><p className="text-[18px] font-bold">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_130px_90px_130px_150px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Referrer</span><span>Referred store</span><span>Progress</span><span>Window</span><span className="text-right">Reward</span><span>Status</span><span className="text-right">Actions</span>
          </div>
          {q.isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
          {q.isError && <p className="text-[13px] text-destructive text-center py-10">{(q.error as Error).message}</p>}
          {!q.isLoading && shown.length === 0 && <p className="text-[13px] text-muted-foreground text-center py-10">No merchant referrals yet.</p>}
          {shown.map((r) => {
            const [sl, sc] = STATUS[r.status] ?? [r.status, "bg-muted text-muted-foreground"];
            const pct = Math.min(100, Math.round((r.delivered_count / Math.max(r.target_orders, 1)) * 100));
            const left = r.window_expires_at ? Math.ceil((new Date(r.window_expires_at).getTime() - Date.now()) / 86400000) : null;
            return (
              <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_130px_90px_130px_150px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]">
                <div className="min-w-0"><p className="font-semibold truncate">{r.referrer_name ?? "—"}</p><p className="text-[12px] text-muted-foreground">{formatPhone(r.referrer_phone)}</p></div>
                <div className="min-w-0"><p className="font-semibold truncate">{r.referred_name ?? "—"}</p><p className="text-[12px] text-muted-foreground">{r.live_at ? `Live ${day(r.live_at)}` : "Not live yet"}</p></div>
                <div>
                  <p className="text-[12px] font-semibold">{r.delivered_count} / {r.target_orders} orders</p>
                  <div className="h-1.5 rounded-full bg-muted mt-1"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
                <span className="text-[12px] text-muted-foreground">
                  {!r.live_at ? "Starts when Live" : left !== null && left > 0 && r.status === "in_progress" ? `${left} days left` : `Ended ${day(r.window_expires_at)}`}
                </span>
                <span className="text-right font-semibold">{inr(r.reward_amount)}</span>
                <div>
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${sc}`}>{sl}</span>
                  {r.status === "earned" && <p className="text-[11px] text-muted-foreground mt-1">{day(r.earned_at)}{r.earned_by ? " · manual" : " · auto"}</p>}
                  {r.reversal_reason && <p className="text-[11px] text-muted-foreground mt-1 truncate" title={r.reversal_reason}>Reason: {r.reversal_reason}</p>}
                </div>
                <div className="flex justify-end">
                  {isSuper && r.status === "earned" && (
                    <button onClick={() => setReversing(r)} className="h-8 px-2.5 rounded-[10px] border border-destructive/40 text-destructive text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-destructive/5"><Undo2 size={13} /> Reverse</button>
                  )}
                  {isSuper && r.status !== "earned" && (
                    <button
                      onClick={() => { if (confirm(`Mark earned and add ${inr(r.reward_amount)} to ${r.referrer_name}'s ledger?`)) earn.mutate(r.id); }}
                      disabled={earn.isPending}
                      className="h-8 px-2.5 rounded-[10px] bg-primary text-primary-foreground text-[12px] font-semibold inline-flex items-center gap-1"
                    ><Check size={13} /> Mark earned</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {reversing && (
        <div className="fixed inset-0 z-50 bg-foreground/40 grid place-items-center p-4">
          <div className="bg-card border border-border rounded-[18px] w-full max-w-[420px] p-6 space-y-4">
            <h3 className="text-[16px] font-bold">Reverse referral reward</h3>
            <p className="text-[13px] text-muted-foreground">
              {inr(reversing.reward_amount)} will be deducted from {reversing.referrer_name}'s ledger (referral of {reversing.referred_name}).
            </p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for reversal" rows={3}
              className="w-full p-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setReversing(null)} className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold">Cancel</button>
              <button onClick={() => rev.mutate()} disabled={rev.isPending || !reason.trim()} className="h-10 px-4 rounded-[12px] bg-destructive text-destructive-foreground text-[13px] font-semibold disabled:opacity-60">Reverse</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
