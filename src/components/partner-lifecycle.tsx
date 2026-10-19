import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const err = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fmt = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const inp = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export type LifeStatus = "active" | "warning" | "inactive" | "suspended" | "terminated" | "exited";
export const STATUS_LABEL: Record<LifeStatus, string> = { active: "Active", warning: "Warning", inactive: "Inactive", suspended: "Suspended", terminated: "Terminated", exited: "Exited" };
const STATUS_CLS: Record<LifeStatus, string> = {
  active: "bg-success/15 text-success",
  warning: "bg-warning/25 text-foreground",
  inactive: "bg-muted text-muted-foreground",
  suspended: "bg-warning/15 text-warning ring-1 ring-warning",
  terminated: "bg-destructive/15 text-destructive",
  exited: "border border-border text-muted-foreground",
};
export function StatusChip({ s }: { s: string }) {
  const k = (s in STATUS_LABEL ? s : "inactive") as LifeStatus;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLS[k]}`}>{STATUS_LABEL[k]}</span>;
}
export const renewalDue = (end: string | null, status: string) => {
  if (!end || status === "terminated" || status === "exited") return false;
  const days = (new Date(`${end}T00:00:00`).getTime() - new Date(`${istToday()}T00:00:00`).getTime()) / 86400000;
  return days >= 0 && days <= 15;
};

const REASONS: Record<string, string[]> = {
  warning: ["KPI missed", "Low activity", "Complaint received", "Other"],
  suspend: ["Repeated KPI miss", "Complaint", "Fraud suspected", "Harassment", "Other"],
  reactivate: ["Issue resolved", "KPI back on track", "Other"],
  terminate: ["Fake orders", "Self orders", "Fake experts", "Customer-expert ko bahar le jaana", "Experts se paise lena", "badiyos ke naam pe extra paise", "Expert ke saath badtameezi-harassment", "Data misuse", "Repeated suspensions", "Lagatar Inactive", "Other"],
  exit: ["Personal reasons", "Not profitable", "Relocation", "Other"],
  renew: ["Agreement renewal", "Other"],
  upgrade: ["Partner requested upgrade", "Other"],
};
const ACTION_LABEL: Record<string, string> = { warning: "Warn", suspend: "Suspend", reactivate: "Reactivate", terminate: "Terminate", exit: "Exit", renew: "Renew", upgrade: "Upgrade" };
const GROWTH_ORDER = ["Growth Silver", "Growth Gold", "Growth Platinum"];

type P = {
  id: string; status: string; program: string; plan_id: string | null; agreement_start: string; agreement_end: string;
  deposit_amount?: number | null; pan_number?: string | null; bank_verified?: boolean; suspensions_this_year?: number; active_months_count?: number;
  suspension_end?: string | null; exit_effective_date?: string | null; exit_requested_at?: string | null; commission_hold?: string | null;
  termination_recommended?: boolean; pending_plan_id?: string | null; pending_plan_from?: string | null; status_reason?: string | null;
};
type Plan = { id: string; name: string; partner_type: string; suggested_fee: number; rules?: Record<string, number> };

export function LifecyclePanel({ p, plans, isAdmin }: { p: P; plans: Plan[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const plan = plans.find((x) => x.id === p.plan_id);
  const rules = plan?.rules ?? {};
  const maxSusp = Number(rules.max_suspensions_per_year ?? 3);
  const minActive = Number(rules.renewal_min_active_months ?? 8);
  const ended = p.status === "terminated" || p.status === "exited";
  const [act, setAct] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [text, setText] = useState("");
  const [immediate, setImmediate] = useState(false); const [hold, setHold] = useState(""); const [override, setOverride] = useState(false);
  const [toPlan, setToPlan] = useState(""); const [feeDiff, setFeeDiff] = useState("");
  const [kyc, setKyc] = useState({ pan: p.pan_number ?? "", bank: !!p.bank_verified, deposit: String(p.deposit_amount ?? "") });
  const hist = useQuery({ queryKey: ["partner-history", p.id], queryFn: async () => { const { data, error } = await db.from("partner_status_history").select("*").eq("partner_id", p.id).order("created_at", { ascending: false }); if (error) throw error; return data as { id: string; action: string; from_status: string; to_status: string; reason: string; details: Record<string, unknown>; created_at: string }[]; } });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["partner-program"] }); qc.invalidateQueries({ queryKey: ["partner-history", p.id] }); };
  const run = useMutation({
    mutationFn: async () => {
      if (!reason) throw new Error("Choose a reason");
      const full = text.trim() ? `${reason}: ${text.trim()}` : reason;
      const opts: Record<string, unknown> = { immediate, hold, override, plan_id: toPlan, fee_difference: feeDiff === "" ? null : Number(feeDiff) };
      const { data, error } = await db.rpc("staff_partner_lifecycle", { _partner_id: p.id, _action: act, _reason: full, _opts: opts });
      if (error) throw error; return data as Record<string, unknown>;
    },
    onSuccess: (d) => {
      const extra = d.refund_eligible ? " · Refund eligible (kit/training kharch kaat ke)" : d.termination_recommended ? " · Termination recommended" : "";
      toast.success(`${ACTION_LABEL[act!]} done${extra}`); setAct(null); setReason(""); setText(""); refresh();
    },
    onError: (e) => toast.error(err(e)),
  });
  const saveKyc = useMutation({
    mutationFn: async () => { const { error } = await db.rpc("staff_partner_set_kyc", { _partner_id: p.id, _pan: kyc.pan, _bank_verified: kyc.bank, _deposit: kyc.deposit === "" ? null : Number(kyc.deposit) }); if (error) throw error; },
    onSuccess: () => { toast.success("Saved"); refresh(); }, onError: (e) => toast.error(err(e)),
  });
  const avail = ended ? [] : ["warning", "suspend", "reactivate", "terminate", "exit", "renew", ...(p.program === "growth" ? ["upgrade"] : [])].filter((a) => {
    if (a === "reactivate") return p.status === "suspended" || p.status === "inactive";
    if (a === "suspend") return p.status !== "suspended";
    if (a === "warning") return p.status === "active";
    if (a === "exit") return !p.exit_requested_at;
    if (a === "upgrade") return !!plan && GROWTH_ORDER.indexOf(plan.name) >= 0 && GROWTH_ORDER.indexOf(plan.name) < 2;
    return true;
  });
  const upgradeTargets = plans.filter((x) => plan && GROWTH_ORDER.indexOf(x.name) > GROWTH_ORDER.indexOf(plan.name));
  const flags: string[] = [];
  if (p.termination_recommended || (p.suspensions_this_year ?? 0) >= maxSusp) flags.push("Termination recommended");
  if (p.suspension_end) flags.push(`Suspended till ${fmt(p.suspension_end)}`);
  if (p.exit_effective_date) flags.push(`Exit on ${fmt(p.exit_effective_date)}`);
  if (p.commission_hold) flags.push(`Commission: ${p.commission_hold.replace("_", " ")}`);
  if (p.pending_plan_id) flags.push(`Upgrade from ${fmt(p.pending_plan_from)}`);
  if (!p.pan_number || !p.bank_verified) flags.push("Payout blocked: KYC");

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><StatusChip s={p.status} />{p.status_reason && <span className="text-xs text-muted-foreground">{p.status_reason}</span>}</div>
      {flags.length > 0 && <div className="flex flex-wrap gap-1">{flags.map((f) => <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-xs">{f}</span>)}</div>}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border p-2">Active months<div className="text-sm font-bold">{p.active_months_count ?? 0}/{minActive}</div></div>
        <div className="rounded-md border border-border p-2">Suspensions<div className="text-sm font-bold">{p.suspensions_this_year ?? 0}/{maxSusp}</div></div>
        <div className="rounded-md border border-border p-2">Agreement end<div className="text-sm font-bold">{fmt(p.agreement_end)}</div></div>
      </div>
      {isAdmin && avail.length > 0 && !act && (
        <div className="flex flex-wrap gap-1.5">{avail.map((a) => <Button key={a} size="sm" variant={a === "terminate" ? "destructive" : "outline"} onClick={() => { setAct(a); setReason(""); }}>{ACTION_LABEL[a]}</Button>)}</div>
      )}
      {act && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="font-semibold">{ACTION_LABEL[act]}</div>
          <select className={inp} value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Reason…</option>{REASONS[act].map((r) => <option key={r}>{r}</option>)}</select>
          <input className={inp} placeholder="Details" value={text} onChange={(e) => setText(e.target.value)} />
          {act === "suspend" && <label className="flex items-center gap-2"><input type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} /> Immediate (fraud / harassment)</label>}
          {act === "suspend" && (p.suspensions_this_year ?? 0) + 1 >= maxSusp && <p className="text-xs text-destructive">Termination recommended — this is suspension {(p.suspensions_this_year ?? 0) + 1} of {maxSusp} this year.</p>}
          {act === "reactivate" && p.commission_hold === "on_hold" && <select className={inp} value={hold} onChange={(e) => setHold(e.target.value)}><option value="">Held commission…</option><option value="release">Release</option><option value="forfeit">Forfeit</option></select>}
          {act === "terminate" && <p className="text-xs text-muted-foreground">Fraud reasons forfeit unpaid commission; others pay till last active date. No fee refund. Territory freed. Experts stay with badiyos.</p>}
          {act === "exit" && <p className="text-xs text-muted-foreground">Commission continues for {rules.exit_notice_days ?? 30} days notice, then status Exited.</p>}
          {act === "renew" && (p.active_months_count ?? 0) < minActive && (
            <label className="flex items-center gap-2 text-xs text-destructive"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Not eligible — territory open. Override</label>
          )}
          {act === "upgrade" && (
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={toPlan} onChange={(e) => setToPlan(e.target.value)}><option value="">New plan…</option>{upgradeTargets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <input type="number" min={0} className={inp} placeholder="Fee difference ₹" value={feeDiff} onChange={(e) => setFeeDiff(e.target.value)} />
              <p className="col-span-2 text-xs text-muted-foreground">New plan starts next Monday.</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAct(null)}>Cancel</Button>
            <Button size="sm" variant={act === "terminate" ? "destructive" : "default"} disabled={run.isPending} onClick={() => { if (window.confirm(`Confirm ${ACTION_LABEL[act]}?`)) run.mutate(); }}>Confirm</Button>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="font-semibold">KYC & deposit</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">PAN<input className={inp} disabled={!isAdmin} value={kyc.pan} onChange={(e) => setKyc({ ...kyc, pan: e.target.value.toUpperCase() })} /></label>
          <label className="text-xs">Deposit collected ₹<input type="number" min={0} className={inp} disabled={!isAdmin} value={kyc.deposit} onChange={(e) => setKyc({ ...kyc, deposit: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!isAdmin} checked={kyc.bank} onChange={(e) => setKyc({ ...kyc, bank: e.target.checked })} /> Bank verified</label>
          {isAdmin && <div className="text-right"><Button size="sm" variant="outline" disabled={saveKyc.isPending} onClick={() => saveKyc.mutate()}>Save</Button></div>}
        </div>
      </div>
      <div>
        <div className="mb-1 font-semibold">History</div>
        {(hist.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No changes yet.</p> : (
          <ul className="space-y-1">{hist.data!.map((h) => (
            <li key={h.id} className="rounded-md bg-muted px-2 py-1 text-xs">
              <b>{fmt(h.created_at)}</b> · {h.action.replace("_", " ")} {h.from_status !== h.to_status && <>· {h.from_status} → {h.to_status}</>} · {h.reason}
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}

const ACT_TYPES: [string, string][] = [["society_visit", "Society visit"], ["event", "Event"], ["pamphlet", "Pamphlet"], ["stall", "Stall"], ["other", "Other"]];
const ACT_LABEL = Object.fromEntries(ACT_TYPES);

export function ActivitiesPanel({ partnerId, isAdmin }: { partnerId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const key = ["partner-activities", partnerId];
  const q = useQuery({ queryKey: key, queryFn: async () => { const { data, error } = await db.from("partner_activities").select("*").eq("partner_id", partnerId).order("activity_date", { ascending: false }); if (error) throw error; return data as { id: string; activity_date: string; type: string; notes: string | null; photo_paths: string[] }[]; } });
  const [f, setF] = useState<{ date: string; type: string; notes: string; files: File[] } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (f!.files.length < 1 || f!.files.length > 5) throw new Error("Add 1 to 5 photos");
      const paths: string[] = [];
      for (const file of f!.files) {
        if (file.size > 10 * 1024 * 1024) throw new Error("Each photo must be under 10 MB");
        const path = `${partnerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(file.name.split(".").pop() || "jpg").toLowerCase()}`;
        const up = await supabase.storage.from("partner-activities").upload(path, file, { contentType: file.type }); if (up.error) throw up.error;
        paths.push(path);
      }
      const { error } = await db.rpc("staff_partner_add_activity", { _partner_id: partnerId, _date: f!.date, _type: f!.type, _notes: f!.notes, _paths: paths });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Activity added"); setF(null); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["partner-program"] }); },
    onError: (e) => toast.error(err(e)),
  });
  const open = async (p: string) => { const { data, error } = await supabase.storage.from("partner-activities").createSignedUrl(p, 300); if (error) return toast.error(err(error)); window.open(data.signedUrl, "_blank"); };
  return (
    <div className="space-y-3 text-sm">
      {isAdmin && !f && <Button size="sm" onClick={() => setF({ date: istToday(), type: "society_visit", notes: "", files: [] })}>Add activity</Button>}
      {f && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Date<input type="date" max={istToday()} className={inp} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className="text-xs">Type<select className={inp} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{ACT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <input className={inp} placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <input type="file" multiple accept="image/*" className="block w-full text-xs" onChange={(e) => setF({ ...f, files: Array.from(e.target.files ?? []).slice(0, 5) })} />
          <p className="text-xs text-muted-foreground">{f.files.length}/5 photos</p>
          <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setF(null)}>Cancel</Button><Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button></div>
        </div>
      )}
      {(q.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No activities yet.</p> : (
        <ul className="space-y-1.5">{q.data!.map((a) => (
          <li key={a.id} className="rounded-md border border-border p-2">
            <div className="flex justify-between"><b>{ACT_LABEL[a.type] ?? a.type}</b><span className="text-xs text-muted-foreground">{fmt(a.activity_date)}</span></div>
            {a.notes && <div className="text-xs">{a.notes}</div>}
            <div className="mt-1 flex flex-wrap gap-2">{a.photo_paths.map((p, i) => <button key={p} className="text-xs text-primary" onClick={() => open(p)}>Photo {i + 1}</button>)}</div>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

const KPI_ROWS: [string, string, string][] = [
  ["active_experts", "min_active_experts", "Active experts"],
  ["new_experts", "min_new_experts", "New experts"],
  ["new_customers", "min_new_customers", "New customers"],
  ["promo_activities", "min_promo_activities", "Promos"],
];
const monthLbl = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export function KpiPanel({ partnerId, program, isAdmin }: { partnerId: string; program: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const live = useQuery({ queryKey: ["partner-kpi-live", partnerId], queryFn: async () => { const { data, error } = await db.rpc("staff_partner_kpi_live", { _partner_id: partnerId }); if (error) throw error; return data as { month: string; actuals: Record<string, number>; targets: Record<string, number | boolean>; review_meeting_done: boolean }; } });
  const hist = useQuery({ queryKey: ["partner-kpi-hist", partnerId], queryFn: async () => { const { data, error } = await db.from("partner_kpi_results").select("*").eq("partner_id", partnerId).not("evaluated_at", "is", null).order("month", { ascending: false }).limit(12); if (error) throw error; return data as { id: string; month: string; kpi_met: boolean | null; skipped_reason: string | null; status_before: string; status_after: string; active_experts: number; new_experts: number; new_customers: number; promo_activities: number }[]; } });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["partner-kpi-live", partnerId] }); qc.invalidateQueries({ queryKey: ["partner-kpi-hist", partnerId] }); qc.invalidateQueries({ queryKey: ["partner-program"] }); qc.invalidateQueries({ queryKey: ["partner-history", partnerId] }); };
  const rerun = useMutation({
    mutationFn: async () => { const r = window.prompt("Reason for re-running last month's KPI check?"); if (!r || r.trim().length < 3) throw new Error("Reason is required"); const { data, error } = await db.rpc("staff_partner_kpi_rerun", { _partner_id: partnerId, _reason: r.trim() }); if (error) throw error; return data as { kpi_met?: boolean; skipped?: boolean }; },
    onSuccess: (d) => { toast.success(d.skipped ? "Skipped (partner not active)" : d.kpi_met ? "KPI met" : "KPI missed"); refresh(); },
    onError: (e) => toast.error(err(e)),
  });
  const meet = useMutation({
    mutationFn: async (done: boolean) => { const { error } = await db.rpc("staff_partner_review_meeting", { _partner_id: partnerId, _month: live.data!.month, _done: done }); if (error) throw error; },
    onSuccess: refresh, onError: (e) => toast.error(err(e)),
  });
  const d = live.data;
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex justify-between"><b>{d ? monthLbl(d.month) : "This month"} · live</b>{d?.targets.rampup && <span className="text-xs text-muted-foreground">Ramp-up: 50% targets</span>}</div>
        {live.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : live.error ? <p className="text-xs text-destructive">{err(live.error)}</p> : (
          <div className="space-y-2">
            {KPI_ROWS.filter(([, t]) => d!.targets[t] != null).map(([a, t, l]) => {
              const act = Number(d!.actuals[a] ?? 0), tgt = Number(d!.targets[t]); const pct = tgt > 0 ? Math.min(100, (act / tgt) * 100) : 100;
              return (<div key={a}><div className="flex justify-between text-xs"><span>{l}</span><span className="tabular-nums">{act} / {tgt}</span></div>
                <div className="h-2 rounded-full bg-muted"><div className={`h-2 rounded-full ${act >= tgt ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div></div>);
            })}
            {Object.keys(d!.targets).filter((k) => k.startsWith("min_")).length === 0 && <p className="text-xs text-muted-foreground">No KPI set on this plan.</p>}
            {(d!.targets.review_meeting_required || program === "city_master") && (
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!isAdmin || meet.isPending} checked={d!.review_meeting_done} onChange={(e) => meet.mutate(e.target.checked)} /> Review meeting done this month</label>
            )}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between"><b>Last 12 months</b>{isAdmin && <Button size="sm" variant="outline" disabled={rerun.isPending} onClick={() => rerun.mutate()}>{rerun.isPending ? "Running…" : "Re-run last month"}</Button>}</div>
        {(hist.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No monthly checks yet. The first runs on the 1st at 2:00 AM.</p> : (
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Month</th><th>Met</th><th>Experts / New / Cust / Promo</th><th>Status</th></tr></thead>
            <tbody>{hist.data!.map((h) => (
              <tr key={h.id} className="border-t border-border">
                <td className="py-1">{monthLbl(h.month)}</td>
                <td>{h.kpi_met == null ? <span title={h.skipped_reason ?? ""}>Skipped</span> : h.kpi_met ? "✓" : "✗"}</td>
                <td className="tabular-nums">{h.kpi_met == null ? "—" : `${h.active_experts} / ${h.new_experts} / ${h.new_customers} / ${h.promo_activities}`}</td>
                <td>{h.status_before === h.status_after ? <StatusChip s={h.status_after} /> : <><StatusChip s={h.status_before} /> → <StatusChip s={h.status_after} /></>}</td>
              </tr>))}</tbody></table>
        )}
      </div>
    </div>
  );
}
