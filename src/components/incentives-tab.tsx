import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  PlayCircle,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import {
  listRewardTriggerTypes,
  listRewardPrograms,
  setRewardProgramActive,
  archiveRewardProgram,
  deleteRewardProgram,
  getRewardProgramStats,
  runRewardPeriodJobs,
  type RewardProgram,
} from "@/lib/rewards.functions";
import { IncentiveProgramModal, ACTORS } from "@/components/incentive-program-modal";

const inputCls =
  "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function conditionSummary(p: RewardProgram): string {
  const c = p.condition ?? {};
  const bits: string[] = [];
  if (c["hours"] != null) bits.push(`${c["hours"]} hours`);
  if (c["days"] != null) bits.push(`${c["days"]} active days`);
  if (c["orders_per_day"] != null) bits.push(`${c["orders_per_day"]}+ orders/day`);
  if (c["orders"] != null) bits.push(`${c["orders"]} orders`);
  if (c["count"] != null) bits.push(`${c["count"]} times`);
  if (c["referral_count"] != null) bits.push(`${c["referral_count"]} referrals`);
  if (c["period"] != null) bits.push(String(c["period"]));
  if (c["tier_group"] != null) bits.push(`slab: ${c["tier_group"]}`);
  if (c["min_avg_rating"] != null) bits.push(`rating ≥ ${c["min_avg_rating"]}`);
  if (c["no_complaints"]) bits.push("no complaints");
  if (c["require_on_time"]) bits.push("on-time");
  if (c["monthly_budget"] != null) bits.push(`cap ${inr.format(Number(c["monthly_budget"]))}`);
  return bits.length ? bits.join(" · ") : "no conditions";
}

export function IncentivesTab({ canWrite }: { canWrite: boolean }) {
  const [actor, setActor] = useState<string>("partner");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<RewardProgram | "new" | null>(null);
  const [deleting, setDeleting] = useState<RewardProgram | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const qc = useQueryClient();
  const fetchTriggers = useServerFn(listRewardTriggerTypes);
  const fetchPrograms = useServerFn(listRewardPrograms);
  const fetchStats = useServerFn(getRewardProgramStats);
  const toggleFn = useServerFn(setRewardProgramActive);
  const archiveFn = useServerFn(archiveRewardProgram);
  const deleteFn = useServerFn(deleteRewardProgram);
  const runJobsFn = useServerFn(runRewardPeriodJobs);

  const { data: triggers = [] } = useQuery({
    queryKey: ["rewards", "triggers"],
    queryFn: () => fetchTriggers(),
    staleTime: 300_000,
  });

  const { data: programs = [], isLoading } = useQuery({
    queryKey: ["rewards", "programs", actor, showArchived],
    queryFn: () => fetchPrograms({ data: { actor_type: actor, archived: showArchived } }),
  });

  const { data: stats = [] } = useQuery({
    queryKey: ["rewards", "stats"],
    queryFn: () => fetchStats({ data: {} }),
  });

  const statMap = useMemo(() => new Map(stats.map((s) => [s.program_id, s])), [stats]);

  const toggle = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards", "programs"] });
      toast.success("Incentive updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => archiveFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["rewards", "programs"] });
      toast.success(v.archived ? "Incentive archived" : "Incentive restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (v: { id: string; force: boolean }) => deleteFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards"] });
      setDeleting(null);
      setConfirmText("");
      toast.success("Incentive deleted — payout history kept");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runJobs = useMutation({
    mutationFn: () => runJobsFn({ data: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["rewards"] });
      toast.success(`Evaluation done — ${r.granted} bonus(es) credited`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <p className="text-[13px] text-muted-foreground max-w-[620px]">
          Bonus plans for experts, partners, customers and merchants. Weekly plans run every Monday
          morning and monthly plans on the 1st — before payout batches are generated.
        </p>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => runJobs.mutate()}
              disabled={runJobs.isPending}
              className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-2 hover:bg-muted disabled:opacity-60"
            >
              <PlayCircle size={16} /> Run evaluation now
            </button>
            <button
              onClick={() => setEditing("new")}
              className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-semibold text-[13px] inline-flex items-center gap-2"
            >
              <Plus size={16} /> New incentive
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {ACTORS.map((a) => (
          <button
            key={a.key}
            onClick={() => setActor(a.key)}
            className={`h-9 px-4 rounded-full text-[13px] font-semibold border ${
              actor === a.key
                ? "border-primary bg-primary-tint text-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`h-9 px-4 rounded-full text-[13px] font-semibold border inline-flex items-center gap-2 ${
            showArchived
              ? "border-primary bg-primary-tint text-foreground"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <Archive size={14} /> Archived
        </button>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_120px_110px_100px_150px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Plan</span>
          <span>Earned on</span>
          <span className="text-right">Amount</span>
          <span>How often</span>
          <span className="text-right">Paid</span>
          <span className="text-right">Actions</span>
        </div>
        {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
        {!isLoading && programs.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            {showArchived ? "No archived incentive plans here." : "No incentive plans yet."}
          </p>
        )}
        {grouped.map((g) => (
          <div key={g.key}>
            <div className="px-6 py-2.5 bg-muted/60 border-b border-border">
              <p className="text-[12px] font-bold">{g.title}</p>
              <p className="text-[11px] text-muted-foreground">{g.note}</p>
            </div>
            {g.items.map((p) => {
          const st = statMap.get(p.id);
          const trig = triggers.find((t) => t.key === p.trigger_type);
          return (
            <div
              key={p.id}
              className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_120px_110px_100px_150px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
            >
              <div className="min-w-0">
                <p className="font-semibold truncate">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {p.valid_from || p.valid_until
                    ? `${p.valid_from ? new Date(p.valid_from).toLocaleDateString() : "—"} → ${
                        p.valid_until ? new Date(p.valid_until).toLocaleDateString() : "—"
                      }`
                    : "Always running"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[13px] truncate">{trig?.label ?? p.trigger_type}</p>
                <p className="text-[11px] text-muted-foreground truncate">{conditionSummary(p)}</p>
              </div>
              <span className="text-right font-semibold">
                {p.reward_type === "cash" ? inr.format(p.reward_value) : `${p.reward_value} coins`}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {p.recurrence.replace(/_/g, " ")}
              </span>
              <span className="text-right font-semibold">{st?.times_triggered ?? 0}</span>
              <div className="flex items-center justify-end gap-2">
                {p.archived_at ? (
                  <span className="h-8 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-muted text-muted-foreground grid place-items-center">
                    Archived
                  </span>
                ) : (
                  <button
                    disabled={!canWrite}
                    onClick={() => toggle.mutate({ id: p.id, is_active: !p.is_active })}
                    className={`h-8 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide disabled:opacity-60 ${
                      p.is_active ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.is_active ? "Active" : "Paused"}
                  </button>
                )}
                {canWrite && !p.archived_at && (
                  <button
                    onClick={() => setEditing(p)}
                    aria-label="Edit incentive"
                    className="h-8 w-8 rounded-[10px] border border-border grid place-items-center hover:bg-muted"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {canWrite && (
                  <button
                    onClick={() => archive.mutate({ id: p.id, archived: !p.archived_at })}
                    aria-label={p.archived_at ? "Restore incentive" : "Archive incentive"}
                    title={p.archived_at ? "Restore" : "Archive (keeps history, stops running)"}
                    className="h-8 w-8 rounded-[10px] border border-border grid place-items-center hover:bg-muted"
                  >
                    {p.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                )}
                {canWrite && (
                  <button
                    onClick={() => {
                      setConfirmText("");
                      setDeleting(p);
                    }}
                    aria-label="Delete incentive"
                    className="h-8 w-8 rounded-[10px] border border-destructive/40 text-destructive grid place-items-center hover:bg-destructive/5"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <IncentiveProgramModal
          triggers={triggers}
          actor={actor}
          program={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 bg-foreground/40 grid place-items-center p-4">
          <div className="bg-card border border-border rounded-[18px] w-full max-w-[460px] p-6 space-y-4">
            <h3 className="text-[16px] font-bold">Delete “{deleting.name}” permanently?</h3>
            <p className="text-[13px] text-muted-foreground">
              Bonuses already paid stay in the history under this name. To only stop it from running,
              use Archive instead.
            </p>
            <div className="space-y-1.5">
              <label className={labelCls}>Type DELETE to confirm</label>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className={inputCls}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setDeleting(null);
                  setConfirmText("");
                }}
                className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  archive.mutate({ id: deleting.id, archived: true });
                  setDeleting(null);
                  setConfirmText("");
                }}
                className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
              >
                Archive instead
              </button>
              <button
                onClick={() => remove.mutate({ id: deleting.id, force: true })}
                disabled={remove.isPending || confirmText.trim().toUpperCase() !== "DELETE"}
                className="h-10 px-4 rounded-[12px] bg-destructive text-destructive-foreground text-[13px] font-semibold disabled:opacity-60"
              >
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
