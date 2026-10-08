import { DateInput } from "@/components/date-input";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  getPartnerBatch,
  getPartnerProgram,
  listPartnerBatches,
  partnerPayoutAction,
  savePartner,
  togglePartnerProgram,
  saveCommissionPlan,
  type CommissionPlan,
  type PartnerProgram,
  type PartnerRow,
} from "@/lib/partner-program.functions";

const PROGRAM_LABEL: Record<PartnerProgram, string> = {
  growth: "Growth Partner",
  zone_franchise: "Zone Franchise",
  city_master: "City Master",
};
const LINE_LABEL: Record<string, string> = {
  home_cleaning: "Home Cleaning", auto_care: "Auto Care", car_wash: "Auto Care", bike_wash: "Auto Care",
  courier: "Delivery", bulk_delivery: "Bulk Delivery", store_orders: "Store Orders",
};
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const input = "w-full rounded-md border border-input bg-background px-2 py-2 text-sm";
const btn = "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50";
const btnPrimary = `${btn} bg-primary text-primary-foreground`;
const btnGhost = `${btn} border border-border bg-background`;

function lastWeekIST() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const dow = ist.getUTCDay();
  const sun = new Date(ist);
  sun.setUTCDate(ist.getUTCDate() - (dow === 0 ? 7 : dow));
  const mon = new Date(sun);
  mon.setUTCDate(sun.getUTCDate() - 6);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { from: f(mon), to: f(sun) };
}

export function PartnersPage({ role }: { role: string | null }) {
  const isAdmin = role === "super_admin";
  const [tab, setTab] = useState<"partners" | "payouts" | "settings">("partners");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Partner Program</h1>
        <p className="text-sm text-muted-foreground">Growth Partners, Zone Franchise and City Master. Commission is worked out only when you generate a payout.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {(["partners", "payouts", "settings"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
            {t === "partners" ? "Partners" : t === "payouts" ? "Payouts" : "Settings & Switches"}
          </button>
        ))}
      </div>
      {tab === "partners" ? <PartnersTab isAdmin={isAdmin} /> : tab === "payouts" ? <PayoutsTab isAdmin={isAdmin} /> : <SettingsTab isAdmin={isAdmin} />}
    </div>
  );
}

function usePartnerData() {
  const fetch = useServerFn(getPartnerProgram);
  return useQuery({ queryKey: ["partner-program"], queryFn: () => fetch() });
}

/* ---------------- Partners ---------------- */
function PartnersTab({ isAdmin }: { isAdmin: boolean }) {
  const q = usePartnerData();
  const [filter, setFilter] = useState<"all" | PartnerProgram>("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Partial<PartnerRow> | null>(null);
  const rows = useMemo(
    () => (q.data?.partners ?? []).filter((p) => (filter === "all" || p.program === filter) && (status === "all" || p.status === status)),
    [q.data, filter, status],
  );
  const zoneName = (id: string | null) => q.data?.zones.find((z) => z.id === id)?.name ?? "—";
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${input} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All programs</option>
          {Object.entries(PROGRAM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={`${input} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {isAdmin && (
          <button className={`${btnPrimary} ml-auto`} onClick={() => setEditing({ program: "growth", status: "active", fee_collected_at: new Date().toISOString().slice(0, 10), agreement_start: new Date().toISOString().slice(0, 10) })}>
            <Plus className="h-4 w-4" /> Add partner
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Plan</th>
              <th className="p-2">City</th><th className="p-2">Zone</th><th className="p-2">Agreement</th><th className="p-2">Fee paid</th>
              <th className="p-2">Experts</th><th className="p-2">Status</th><th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">No partners yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="p-2 font-semibold">{p.name}</td>
                <td className="p-2">{p.phone}</td>
                <td className="p-2">{q.data?.plans.find((x) => x.id === p.plan_id)?.name ?? "—"}</td>
                <td className="p-2">{p.city}</td>
                <td className="p-2">{p.program === "zone_franchise" ? zoneName(p.zone_id) : "—"}</td>
                <td className="p-2 whitespace-nowrap">{fmtDate(p.agreement_start)} – {fmtDate(p.agreement_end)}</td>
                <td className="p-2">{inr(p.fee_paid)}{p.fee_collected_at && <div className="text-xs text-muted-foreground">{fmtDate(p.fee_collected_at)}</div>}</td>
                <td className="p-2">{p.program === "growth" ? q.data?.expertCounts[p.id] ?? 0 : "—"}</td>
                <td className="p-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{p.status === "active" ? "Active" : "Inactive"}</span>
                </td>
                <td className="p-2">{isAdmin && <button className="text-primary" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <PartnerForm initial={editing} zones={q.data?.zones ?? []} plans={q.data?.plans ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-background p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PartnerForm({ initial, zones, plans, onClose }: { initial: Partial<PartnerRow>; zones: { id: string; name: string; city: string }[]; plans: CommissionPlan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(savePartner);
  const [f, setF] = useState<Partial<PartnerRow>>(initial);
  const [loginEmail, setLoginEmail] = useState(initial.login_email ?? "");
  const [loginPassword, setLoginPassword] = useState("");
  const hasLogin = !!initial.auth_user_id;
  const set = <K extends keyof PartnerRow>(k: K, v: PartnerRow[K] | null) => setF((p) => ({ ...p, [k]: v }));
  const cities = Array.from(new Set(zones.map((z) => z.city).filter(Boolean)));
  const m = useMutation({
    mutationFn: () => save({ data: { ...f, login_email: loginEmail || null, login_password: loginPassword || null } }),
    onSuccess: () => {
      toast.success("Partner saved");
      qc.invalidateQueries({ queryKey: ["partner-program"] });
      qc.invalidateQueries({ queryKey: ["growth-partners"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const autoEnd = (start: string) => {
    const d = new Date(start);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  return (
    <Modal title={f.id ? "Edit partner" : "Add partner"} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">Name<input className={input} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></label>
        <label className="text-sm">Phone<input className={input} value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></label>
        <label className="text-sm">Login email (Command Center)<input type="email" autoComplete="off" className={input} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="partner@example.com" /></label>
        <label className="text-sm">{hasLogin ? "New password (blank = keep)" : "Login password"}<input type="text" autoComplete="new-password" className={input} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Min 6 characters" /></label>
        <label className="text-sm">Program
          <select className={input} value={f.program} onChange={(e) => {
            const p = e.target.value as PartnerProgram;
            setF((x) => ({ ...x, program: p, plan_id: null, growth_plan_id: p === "growth" ? null : x.growth_plan_id ?? null, zone_id: p === "zone_franchise" ? x.zone_id : null }));
          }}>
            {Object.entries(PROGRAM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm">Commission plan
          <select className={input} value={f.plan_id ?? ""} onChange={(e) => {
            const pl = plans.find((x) => x.id === e.target.value);
            setF((x) => ({ ...x, plan_id: e.target.value || null, fee_paid: x.id ? x.fee_paid : pl?.suggested_fee ?? x.fee_paid }));
          }}>
            <option value="">Choose plan</option>
            {plans.filter((x) => x.partner_type === f.program && (x.status === "active" || x.id === initial.plan_id)).map((x) => (
              <option key={x.id} value={x.id}>{x.name} · suggested {inr(x.suggested_fee)}{x.status !== "active" ? " (inactive)" : ""}</option>
            ))}
          </select>
        </label>
        {f.program !== "growth" && (
          <label className="text-sm sm:col-span-2">Growth plan (for own onboarded Experts)
            <select className={input} value={f.growth_plan_id ?? ""} onChange={(e) => set("growth_plan_id", e.target.value || null)}>
              <option value="">— None —</option>
              {plans.filter((x) => x.partner_type === "growth" && (x.status === "active" || x.id === initial.growth_plan_id)).map((x) => (
                <option key={x.id} value={x.id}>{x.name}{x.status !== "active" ? " (inactive)" : ""}</option>
              ))}
            </select>
          </label>
        )}
        {f.program === "zone_franchise" ? (
          <label className="text-sm">Zone
            <select className={input} value={f.zone_id ?? ""} onChange={(e) => {
              const z = zones.find((x) => x.id === e.target.value);
              setF((x) => ({ ...x, zone_id: e.target.value || null, city: z?.city ?? x.city }));
            }}>
              <option value="">Choose zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name} · {z.city}</option>)}
            </select>
          </label>
        ) : (
          <label className="text-sm">City
            <input className={input} list="partner-cities" value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            <datalist id="partner-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
        )}
        <label className="text-sm">Agreement start<DateInput  className={input} value={f.agreement_start ?? ""} onChange={(e) => setF((x) => ({ ...x, agreement_start: e.target.value, agreement_end: e.target.value ? autoEnd(e.target.value) : x.agreement_end }))} /></label>
        <label className="text-sm">Agreement end<DateInput  className={input} value={f.agreement_end ?? ""} onChange={(e) => set("agreement_end", e.target.value)} /></label>
        <label className="text-sm">Fee collected date<DateInput  className={input} value={f.fee_collected_at ?? ""} onChange={(e) => set("fee_collected_at", e.target.value || null)} /></label>
        <label className="text-sm">Deposit / Fee collected (₹)<input type="number" min={0} className={input} value={f.fee_paid ?? 0} onChange={(e) => set("fee_paid", Number(e.target.value))} /></label>
        <label className="text-sm">Status
          <select className={input} value={f.status} onChange={(e) => set("status", e.target.value as PartnerRow["status"])}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">Notes<textarea className={input} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

/* ---------------- Settings ---------------- */
function SettingsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = usePartnerData();
  const toggle = useServerFn(togglePartnerProgram);
  const s = q.data?.settings ?? {};
  const t = useMutation({
    mutationFn: (v: { program: "master" | PartnerProgram; enabled: boolean }) => toggle({ data: v }),
    onSuccess: () => { toast.success("Switch updated"); qc.invalidateQueries({ queryKey: ["partner-program"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const switches: { k: "master" | PartnerProgram; col: string; label: string }[] = [
    { k: "master", col: "master_enabled", label: "Partner Program (master)" },
    { k: "growth", col: "growth_enabled", label: "Growth Partner" },
    { k: "zone_franchise", col: "zone_enabled", label: "Zone Franchise" },
    { k: "city_master", col: "city_enabled", label: "City Master" },
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border p-3">
        <h3 className="mb-1 font-bold">On / Off</h3>
        <p className="mb-3 text-xs text-muted-foreground">Orders completed while a program (or the master switch) is OFF never earn commission, even after turning it back ON.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {switches.map((w) => {
            const on = !!s[w.col];
            return (
              <div key={w.k} className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                <span className="text-sm font-semibold">{w.label}</span>
                <button
                  disabled={!isAdmin || t.isPending}
                  onClick={() => t.mutate({ program: w.k, enabled: !on })}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${on ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground border border-border"}`}
                >{on ? "ON" : "OFF"}</button>
              </div>
            );
          })}
        </div>
      </section>
      <PlansSection isAdmin={isAdmin} plans={q.data?.plans ?? []} lines={q.data?.businessLines ?? []} />
    </div>
  );
}

/* ---------------- Payouts ---------------- */
const STATUS_STYLE: Record<string, string> = {
  draft: "bg-warning/15 text-foreground",
  approved: "bg-primary/10 text-primary",
  paid: "bg-primary text-primary-foreground",
  deleted: "bg-muted text-muted-foreground line-through",
};

function PayoutsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const fetch = useServerFn(listPartnerBatches);
  const act = useServerFn(partnerPayoutAction);
  const q = useQuery({ queryKey: ["partner-batches"], queryFn: () => fetch() });
  const [range, setRange] = useState(lastWeekIST());
  const [open, setOpen] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => act({ data: { kind: "generate", from: range.from, to: range.to } }),
    onSuccess: (r) => { toast.success("Draft batch created"); qc.invalidateQueries({ queryKey: ["partner-batches"] }); setOpen(r.id); },
    onError: (e: Error) => toast.error(e.message),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const batches = (q.data ?? []) as any[];
  return (
    <div className="space-y-3">
      {isAdmin && (
        <section className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <label className="text-sm">From<DateInput  className={input} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
          <label className="text-sm">To<DateInput  className={input} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
          <button className={btnPrimary} disabled={gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? "Generating…" : "Generate Partner Payout"}</button>
          <p className="w-full text-xs text-muted-foreground">Default is last Monday–Sunday (IST). Orders already in another live batch are skipped.</p>
        </section>
      )}
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No partner payout batches yet.</p>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <div key={b.id} className="rounded-lg border border-border">
              <button className="flex w-full flex-wrap items-center gap-3 p-3 text-left" onClick={() => setOpen(open === b.id ? null : b.id)}>
                {open === b.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span className="font-semibold">{fmtDate(b.period_start)} – {fmtDate(b.period_end)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[b.status]}`}>{b.status}</span>
                <span className="ml-auto text-sm">Gross {inr(b.total_gross)} · TDS {inr(b.total_tds)} · <b>Net {inr(b.total_net)}</b></span>
              </button>
              {open === b.id && <BatchDetail batchId={b.id} isAdmin={isAdmin} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchDetail({ batchId, isAdmin }: { batchId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const fetch = useServerFn(getPartnerBatch);
  const act = useServerFn(partnerPayoutAction);
  const q = useQuery({ queryKey: ["partner-batch", batchId], queryFn: () => fetch({ data: { batchId } }) });
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const run = useMutation({
    mutationFn: (d: Parameters<typeof act>[0]["data"]) => act({ data: d }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["partner-batch", batchId] });
      qc.invalidateQueries({ queryKey: ["partner-batches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ask = (msg: string) => {
    const r = window.prompt(msg);
    return r && r.trim() ? r.trim() : null;
  };
  if (q.isLoading) return <p className="p-3 text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data?.batch) return <p className="p-3 text-sm text-destructive">Could not load this batch.</p>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { batch, items, lines } = q.data as { batch: any; items: any[]; lines: any[] };
  const draft = batch.status === "draft" && isAdmin;
  const visibleItems = items.filter((i) => showDeleted || !i.is_deleted);
  return (
    <div className="space-y-3 border-t border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show removed</label>
        {batch.paid_on && <span className="text-xs text-muted-foreground">Paid on {fmtDate(batch.paid_on)}{batch.paid_reference ? ` · Ref ${batch.paid_reference}` : ""}</span>}
        {batch.delete_reason && <span className="text-xs text-muted-foreground">Deleted: {batch.delete_reason}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {draft && (
            <>
              <button className={btnGhost} onClick={() => { const r = ask("Reason for deleting the whole batch?"); if (r) run.mutate({ kind: "deleteBatch", id: batchId, reason: r }); }}><Trash2 className="h-4 w-4" /> Delete batch</button>
              <button className={btnPrimary} onClick={() => { if (window.confirm("Approve this batch? It can no longer be edited.")) run.mutate({ kind: "approve", id: batchId }); }}>Approve</button>
            </>
          )}
          {batch.status === "approved" && isAdmin && (
            <button className={btnPrimary} onClick={() => {
              const d = window.prompt("Payment date (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
              if (!d) return;
              const ref = window.prompt("Payment reference (UTR / note)") ?? "";
              run.mutate({ kind: "markPaid", id: batchId, paidOn: d, reference: ref });
            }}>Mark Paid</button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr><th className="p-2" /><th className="p-2">Partner</th><th className="p-2">Program</th><th className="p-2">Orders</th><th className="p-2">Total</th><th className="p-2">TDS</th><th className="p-2">Net payable</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {visibleItems.map((it) => {
              const its = lines.filter((l) => l.item_id === it.id && (showDeleted || !l.is_deleted));
              const live = lines.filter((l) => l.item_id === it.id && !l.is_deleted).length;
              return (
                <Fragment key={it.id}>
                  <tr className={`border-t border-border ${it.is_deleted ? "opacity-50" : ""}`}>
                    <td className="p-2"><button onClick={() => setOpenItem(openItem === it.id ? null : it.id)}>{openItem === it.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                    <td className="p-2 font-semibold">{it.partners?.name}<div className="text-xs font-normal text-muted-foreground">{it.partners?.phone}</div></td>
                    <td className="p-2">{PROGRAM_LABEL[it.partners?.program as PartnerProgram]}{it.partners?.partner_commission_plans?.name ? ` · ${it.partners.partner_commission_plans.name}` : ""}</td>
                    <td className="p-2">{live}</td>
                    <td className="p-2">{inr(it.gross_amount)}</td>
                    <td className="p-2">{inr(it.tds_amount)} <span className="text-xs text-muted-foreground">({it.tds_rate}%)</span></td>
                    <td className="p-2 font-bold">{inr(it.net_amount)}</td>
                    <td className="p-2">{draft && !it.is_deleted && (
                      <button className="text-destructive" title="Remove partner" onClick={() => { const r = ask(`Reason for removing ${it.partners?.name}?`); if (r) run.mutate({ kind: "deleteItem", id: it.id, reason: r }); }}><Trash2 className="h-4 w-4" /></button>
                    )}</td>
                  </tr>
                  {openItem === it.id && (
                    <tr key={`${it.id}-lines`}>
                      <td colSpan={8} className="bg-muted/50 p-2">
                        <table className="w-full text-xs">
                          <thead className="text-left text-muted-foreground"><tr><th className="p-1">Order</th><th className="p-1">Date</th><th className="p-1">Service</th><th className="p-1">Program</th><th className="p-1">Plan · Line</th><th className="p-1">Base</th><th className="p-1">%</th><th className="p-1">Commission</th><th className="p-1" /></tr></thead>
                          <tbody>
                            {its.map((l) => (
                              <tr key={l.id} className={l.is_deleted ? "opacity-50 line-through" : ""}>
                                <td className="p-1 font-mono">{String(l.order_id).slice(0, 8)}</td>
                                <td className="p-1">{fmtDate(l.order_completed_at)}</td>
                                <td className="p-1">{l.service_name}</td>
                                <td className="p-1">{PROGRAM_LABEL[l.program as PartnerProgram]}</td>
                                <td className="p-1">{l.plan_name ?? "—"} · {LINE_LABEL[l.business_line] ?? l.business_line ?? "—"}</td>
                                <td className="p-1">{inr(l.base_amount)}</td>
                                <td className="p-1">{l.commission_pct}%</td>
                                <td className="p-1 font-semibold">{inr(l.amount)}{Number(l.amount) !== Number(l.calculated_amount) && <span className="ml-1 text-muted-foreground" title={l.edit_reason ?? ""}>(was {inr(l.calculated_amount)})</span>}</td>
                                <td className="p-1 whitespace-nowrap">{draft && !l.is_deleted && (
                                  <>
                                    <button className="mr-2 text-primary" onClick={() => {
                                      const a = window.prompt("New commission amount (₹)", String(l.amount));
                                      if (a === null || a.trim() === "" || isNaN(Number(a))) return;
                                      const r = ask("Reason for this change?");
                                      if (r) run.mutate({ kind: "editLine", id: l.id, amount: Number(a), reason: r });
                                    }}><Pencil className="h-3.5 w-3.5" /></button>
                                    <button className="text-destructive" onClick={() => { const r = ask("Reason for removing this order?"); if (r) run.mutate({ kind: "deleteLine", id: l.id, reason: r }); }}><Trash2 className="h-3.5 w-3.5" /></button>
                                  </>
                                )}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlansSection({ isAdmin, plans, lines }: { isAdmin: boolean; plans: CommissionPlan[]; lines: { key: string; label: string }[] }) {
  const [editing, setEditing] = useState<Partial<CommissionPlan> | null>(null);
  return (
    <section className="rounded-lg border border-border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">Commission Plans</h3>
          <p className="text-xs text-muted-foreground">Each plan sets ON/OFF and % per business line. Changes apply only to payouts generated afterwards.</p>
        </div>
        {isAdmin && <button className={btnPrimary} onClick={() => setEditing({ partner_type: "growth", status: "active", suggested_fee: 0, sort_order: plans.reduce((m, x) => Math.max(m, x.sort_order ?? 0), 0) + 1, lines: [] })}><Plus className="h-4 w-4" /> New plan</button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[...plans].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)).map((p) => (
          <div key={p.id} className={`rounded-md border border-border p-3 ${p.status !== "active" ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">#{p.sort_order}</span>{p.name}</p>
                <p className="text-xs text-muted-foreground">{PROGRAM_LABEL[p.partner_type]} · suggested {inr(p.suggested_fee)} / yr · {p.partnerCount} partner{p.partnerCount === 1 ? "" : "s"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{p.status === "active" ? "Active" : "Inactive"}</span>
                {isAdmin && <button className="text-primary" onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></button>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {lines.map((bl) => {
                const l = p.lines.find((x) => x.line_key === bl.key);
                return (
                  <span key={bl.key} className={`rounded-full px-2 py-0.5 text-[11px] ${l?.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground line-through"}`}>
                    {bl.label}{l?.enabled ? ` ${l.pct}%` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {editing && <PlanForm initial={editing} lines={lines} onClose={() => setEditing(null)} />}
    </section>
  );
}

function PlanForm({ initial, lines, onClose }: { initial: Partial<CommissionPlan>; lines: { key: string; label: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(saveCommissionPlan);
  const [f, setF] = useState<Partial<CommissionPlan>>(initial);
  const [rows, setRows] = useState(() =>
    lines.map((bl) => {
      const l = initial.lines?.find((x) => x.line_key === bl.key);
      return { line_key: bl.key, label: bl.label, enabled: l?.enabled ?? false, pct: Number(l?.pct ?? 0) };
    }),
  );
  const m = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: f.id,
          name: f.name ?? "",
          partner_type: (f.partner_type ?? "growth") as PartnerProgram,
          suggested_fee: Number(f.suggested_fee ?? 0),
          sort_order: Number(f.sort_order ?? 0),
          status: f.status ?? "active",
          lines: rows.map(({ line_key, enabled, pct }) => ({ line_key, enabled, pct })),
        },
      }),
    onSuccess: () => { toast.success("Plan saved"); qc.invalidateQueries({ queryKey: ["partner-program"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal title={f.id ? "Edit plan" : "New plan"} onClose={onClose}>
      {f.id && (
        <p className="mb-3 rounded-md bg-warning/15 p-2 text-xs">
          {initial.partnerCount ?? 0} partner{initial.partnerCount === 1 ? "" : "s"} use this plan. Changes apply only to payouts generated after saving.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Plan name<input className={input} value={f.name ?? ""} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></label>
        <label className="text-sm">Partner type
          <select className={input} value={f.partner_type} disabled={!!f.id && (initial.partnerCount ?? 0) > 0} onChange={(e) => setF((x) => ({ ...x, partner_type: e.target.value as PartnerProgram }))}>
            {Object.entries(PROGRAM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-sm">Sort No.<input type="number" min={0} step={1} className={input} value={f.sort_order ?? 0} onChange={(e) => setF((x) => ({ ...x, sort_order: Number(e.target.value) }))} /></label>
        <label className="text-sm">Suggested yearly fee (₹)<input type="number" min={0} className={input} value={f.suggested_fee ?? 0} onChange={(e) => setF((x) => ({ ...x, suggested_fee: Number(e.target.value) }))} /></label>
        <label className="text-sm">Status
          <select className={input} value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value as CommissionPlan["status"] }))}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs font-bold uppercase text-muted-foreground">Business lines</p>
        {rows.map((r, i) => (
          <div key={r.line_key} className="grid grid-cols-[1fr_auto_80px] items-center gap-2">
            <span className="text-sm">{r.label}</span>
            <button
              className={`rounded-full px-3 py-1 text-xs font-bold ${r.enabled ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"}`}
              onClick={() => setRows((x) => x.map((y, j) => (j === i ? { ...y, enabled: !y.enabled } : y)))}
            >{r.enabled ? "ON" : "OFF"}</button>
            <input type="number" min={0} max={100} step="0.1" disabled={!r.enabled} className={input} value={r.pct}
              onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, pct: Number(e.target.value) } : y)))} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Save plan"}</button>
      </div>
    </Modal>
  );
}
