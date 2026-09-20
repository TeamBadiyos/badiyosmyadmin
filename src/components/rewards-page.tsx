import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Undo2, PlayCircle, Search, X, Archive, ArchiveRestore } from "lucide-react";
import {
  listRewardTriggerTypes,
  listRewardPrograms,
  upsertRewardProgram,
  setRewardProgramActive,
  archiveRewardProgram,
  deleteRewardProgram,
  getRewardProgramStats,
  searchRewardLedger,
  reverseReward,
  runRewardPeriodJobs,
  type RewardProgram,
  type RewardTriggerType,
  type RewardCondition,
  type RewardLedgerRow,
} from "@/lib/rewards.functions";
import { IncentiveProgramModal, groupProgramsByTier } from "@/components/incentive-program-modal";

const ACTORS = [
  { key: "customer", label: "Customer" },
  { key: "partner", label: "Partner" },
  { key: "merchant", label: "Merchant" },
] as const;

const REWARD_TYPES = ["coins", "cash"] as const;
const RECURRENCES = ["per_event", "once", "weekly", "monthly"] as const;

const inputCls =
  "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

export function RewardsPage() {
  const [actor, setActor] = useState<string>("customer");
  const [tab, setTab] = useState<"programs" | "reports">("programs");
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

  const statMap = useMemo(
    () => new Map(stats.map((s) => [s.program_id, s])),
    [stats],
  );

  const grouped = useMemo(() => groupProgramsByTier(programs), [programs]);

  const toggle = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards", "programs"] });
      toast.success("Program updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => archiveFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["rewards", "programs"] });
      toast.success(v.archived ? "Program archived" : "Program restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (v: { id: string; force: boolean }) => deleteFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards"] });
      setDeleting(null);
      setConfirmText("");
      toast.success("Program deleted permanently — reward history kept");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runJobs = useMutation({
    mutationFn: () => runJobsFn({ data: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["rewards"] });
      toast.success(`Periodic evaluation done — ${r.granted} reward(s) credited`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex gap-1 p-1 bg-muted rounded-[14px]">
          {(["programs", "reports"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`h-9 px-4 rounded-[10px] text-[13px] font-semibold capitalize ${
                tab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runJobs.mutate()}
            disabled={runJobs.isPending}
            className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-2 hover:bg-muted disabled:opacity-60"
          >
            <PlayCircle size={16} /> Run periodic evaluation
          </button>
          <button
            onClick={() => setEditing("new")}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-semibold text-[13px] inline-flex items-center gap-2"
          >
            <Plus size={16} /> New Program
          </button>
        </div>
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

      {tab === "programs" ? (
        <div className="bg-card border border-border rounded-[18px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_120px_120px_150px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Program</span>
            <span>Trigger &amp; condition</span>
            <span>Reward</span>
            <span>Recurrence</span>
            <span className="text-right">Triggered</span>
            <span className="text-right">Actions</span>
          </div>
          {isLoading && (
            <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
          )}
          {!isLoading && programs.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-10">
              {showArchived
                ? "No archived reward programs for this actor type."
                : "No reward programs for this actor type yet."}
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
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_120px_120px_150px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
              >
                <div className="min-w-0">
                  <p className="font-semibold truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {p.valid_from || p.valid_until
                      ? `${p.valid_from ? new Date(p.valid_from).toLocaleDateString() : "—"} → ${
                          p.valid_until ? new Date(p.valid_until).toLocaleDateString() : "—"
                        }`
                      : "Always scheduled"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] truncate">{trig?.label ?? p.trigger_type}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {Object.keys(p.condition ?? {}).length
                      ? Object.entries(p.condition)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(", ")
                      : "no conditions"}
                  </p>
                </div>
                <span className="font-semibold">
                  {p.reward_value} <span className="text-[11px] text-muted-foreground">{p.reward_type}</span>
                </span>
                <span className="text-[13px] text-muted-foreground">{p.recurrence}</span>
                <span className="text-right font-semibold">{st?.times_triggered ?? 0}</span>
                <div className="flex items-center justify-end gap-2">
                  {p.archived_at ? (
                    <span className="h-8 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-muted text-muted-foreground grid place-items-center">
                      Archived
                    </span>
                  ) : (
                    <button
                      onClick={() => toggle.mutate({ id: p.id, is_active: !p.is_active })}
                      className={`h-8 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                        p.is_active
                          ? "bg-primary-tint text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.is_active ? "Active" : "Paused"}
                    </button>
                  )}
                  {!p.archived_at && (
                    <button
                      onClick={() => setEditing(p)}
                      aria-label="Edit program"
                      className="h-8 w-8 rounded-[10px] border border-border grid place-items-center hover:bg-muted"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => archive.mutate({ id: p.id, archived: !p.archived_at })}
                    aria-label={p.archived_at ? "Restore program" : "Archive program"}
                    title={p.archived_at ? "Restore program" : "Archive (keeps history, stops triggering)"}
                    className="h-8 w-8 rounded-[10px] border border-border grid place-items-center hover:bg-muted"
                  >
                    {p.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmText("");
                      setDeleting(p);
                    }}
                    aria-label="Delete program"
                    className="h-8 w-8 rounded-[10px] border border-destructive/40 text-destructive grid place-items-center hover:bg-destructive/5"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          </div>
          ))}
        </div>
      ) : (
        <ReportsSection programs={programs} actor={actor} />
      )}

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
              This removes the program for good. Rewards already given stay in the history
              under this name. If you only want to stop it from running, use Archive instead.
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


function ReportsSection({ programs, actor }: { programs: RewardProgram[]; actor: string }) {
  const qc = useQueryClient();
  const [programId, setProgramId] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reversing, setReversing] = useState<RewardLedgerRow | null>(null);
  const [reason, setReason] = useState("");

  const fetchStats = useServerFn(getRewardProgramStats);
  const fetchLedger = useServerFn(searchRewardLedger);
  const reverseFn = useServerFn(reverseReward);

  const range = {
    from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
  };

  const { data: stats = [] } = useQuery({
    queryKey: ["rewards", "stats", range.from, range.to],
    queryFn: () => fetchStats({ data: range }),
  });

  const { data: ledger = [], isLoading } = useQuery({
    queryKey: ["rewards", "ledger", actor, programId, search, range.from, range.to],
    queryFn: () =>
      fetchLedger({
        data: { actor_type: actor, program_id: programId || null, search: search || null, ...range },
      }),
  });

  const reverse = useMutation({
    mutationFn: (v: { ledger_id: string; reason: string }) => reverseFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards"] });
      setReversing(null);
      setReason("");
      toast.success("Reward reversed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statMap = new Map(stats.map((s) => [s.program_id, s]));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {programs.map((p) => {
          const st = statMap.get(p.id);
          return (
            <div key={p.id} className="bg-card border border-border rounded-[18px] p-5">
              <p className="font-semibold truncate">{p.name}</p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
                {p.trigger_type.replace(/_/g, " ")}
              </p>
              <div className="flex gap-6 mt-4">
                <div>
                  <p className="text-[22px] font-bold">{st?.times_triggered ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Times triggered</p>
                </div>
                <div>
                  <p className="text-[22px] font-bold">{st?.total_value ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Total {p.reward_type}</p>
                </div>
                <div>
                  <p className="text-[22px] font-bold">{st?.reversed_count ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">Reversed</p>
                </div>
              </div>
            </div>
          );
        })}
        {programs.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No programs for this actor type.</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className={labelCls}>Program</label>
          <select
            value={programId}
            onChange={(e) => setProgramId(e.target.value)}
            className={`${inputCls} min-w-[200px]`}
          >
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <div className="space-y-1.5 flex-1 min-w-[220px]">
          <label className={labelCls}>Search actor (name / phone)</label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, expert or merchant"
              className={`${inputCls} pl-9`}
            />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_160px_110px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Actor</span>
          <span>Program</span>
          <span>Event ref</span>
          <span className="text-right">Reward</span>
          <span>Credited</span>
          <span className="text-right">Status</span>
        </div>
        {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
        {!isLoading && ledger.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No reward history yet.</p>
        )}
        {ledger.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_160px_110px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <div className="min-w-0">
              <p className="font-semibold truncate">{r.actor_name ?? "—"}</p>
              <p className="text-[12px] text-muted-foreground truncate">{r.actor_phone ?? ""}</p>
            </div>
            <span className="truncate">{r.program_name}</span>
            <span className="truncate text-[12px] text-muted-foreground" title={r.notes ?? ""}>
              {r.trigger_event_ref}
            </span>
            <span className="text-right font-semibold">
              {r.reward_value} <span className="text-[11px] text-muted-foreground">{r.reward_type}</span>
            </span>
            <span className="text-[13px] text-muted-foreground">
              {new Date(r.credited_at).toLocaleString()}
            </span>
            <div className="flex justify-end">
              {r.status === "credited" ? (
                <button
                  onClick={() => setReversing(r)}
                  className="h-8 px-2.5 rounded-[10px] border border-destructive/40 text-destructive text-[12px] font-semibold inline-flex items-center gap-1 hover:bg-destructive/5"
                >
                  <Undo2 size={13} /> Reverse
                </button>
              ) : (
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Reversed
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {reversing && (
        <div className="fixed inset-0 z-50 bg-foreground/40 grid place-items-center p-4">
          <div className="bg-card border border-border rounded-[18px] w-full max-w-[420px] p-6 space-y-4">
            <h3 className="text-[16px] font-bold">Reverse reward</h3>
            <p className="text-[13px] text-muted-foreground">
              {reversing.actor_name ?? "Actor"} — {reversing.reward_value} {reversing.reward_type} from{" "}
              {reversing.program_name}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for reversal"
              rows={3}
              className="w-full p-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setReversing(null)}
                className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => reverse.mutate({ ledger_id: reversing.id, reason })}
                disabled={reverse.isPending || !reason.trim()}
                className="h-10 px-4 rounded-[12px] bg-destructive text-destructive-foreground text-[13px] font-semibold disabled:opacity-60"
              >
                Reverse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
