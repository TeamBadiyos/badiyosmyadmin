import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Undo2, PlayCircle, Search, X } from "lucide-react";
import {
  listRewardTriggerTypes,
  listRewardPrograms,
  upsertRewardProgram,
  setRewardProgramActive,
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

const ACTORS = [
  { key: "customer", label: "Customer" },
  { key: "partner", label: "Partner" },
  { key: "merchant", label: "Merchant" },
] as const;

const REWARD_TYPES = ["coins", "cash", "free_booking", "percentage_off"] as const;
const RECURRENCES = ["per_event", "once", "weekly", "monthly"] as const;

const inputCls =
  "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

export function RewardsPage() {
  const [actor, setActor] = useState<string>("customer");
  const [tab, setTab] = useState<"programs" | "reports">("programs");
  const [editing, setEditing] = useState<RewardProgram | "new" | null>(null);

  const qc = useQueryClient();
  const fetchTriggers = useServerFn(listRewardTriggerTypes);
  const fetchPrograms = useServerFn(listRewardPrograms);
  const fetchStats = useServerFn(getRewardProgramStats);
  const toggleFn = useServerFn(setRewardProgramActive);
  const deleteFn = useServerFn(deleteRewardProgram);
  const runJobsFn = useServerFn(runRewardPeriodJobs);

  const { data: triggers = [] } = useQuery({
    queryKey: ["rewards", "triggers"],
    queryFn: () => fetchTriggers(),
    staleTime: 300_000,
  });

  const { data: programs = [], isLoading } = useQuery({
    queryKey: ["rewards", "programs", actor],
    queryFn: () => fetchPrograms({ data: { actor_type: actor } }),
  });

  const { data: stats = [] } = useQuery({
    queryKey: ["rewards", "stats"],
    queryFn: () => fetchStats({ data: {} }),
  });

  const statMap = useMemo(
    () => new Map(stats.map((s) => [s.program_id, s])),
    [stats],
  );

  const toggle = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => toggleFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards", "programs"] });
      toast.success("Program updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards", "programs"] });
      toast.success("Program deleted");
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
              No reward programs for this actor type yet.
            </p>
          )}
          {programs.map((p) => {
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
                  <button
                    onClick={() => setEditing(p)}
                    aria-label="Edit program"
                    className="h-8 w-8 rounded-[10px] border border-border grid place-items-center hover:bg-muted"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${p.name}"?`)) remove.mutate(p.id);
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
      ) : (
        <ReportsSection programs={programs} actor={actor} />
      )}

      {editing && (
        <ProgramModal
          triggers={triggers}
          actor={actor}
          program={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProgramModal({
  triggers,
  actor,
  program,
  onClose,
}: {
  triggers: RewardTriggerType[];
  actor: string;
  program: RewardProgram | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(upsertRewardProgram);

  const available = triggers.filter((t) =>
    t.actor_types.includes(program?.actor_type ?? actor),
  );

  const [name, setName] = useState(program?.name ?? "");
  const [actorType, setActorType] = useState(program?.actor_type ?? actor);
  const [triggerType, setTriggerType] = useState(
    program?.trigger_type ?? available[0]?.key ?? "",
  );
  const [condition, setCondition] = useState<RewardCondition>(program?.condition ?? {});
  const [rewardType, setRewardType] = useState(program?.reward_type ?? "coins");
  const [rewardValue, setRewardValue] = useState(String(program?.reward_value ?? 10));
  const [recurrence, setRecurrence] = useState(program?.recurrence ?? "per_event");
  const [validFrom, setValidFrom] = useState(program?.valid_from?.slice(0, 10) ?? "");
  const [validUntil, setValidUntil] = useState(program?.valid_until?.slice(0, 10) ?? "");
  const [isActive, setIsActive] = useState(program?.is_active ?? true);

  const trig = triggers.find((t) => t.key === triggerType);
  const fields = trig?.condition_schema ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: program?.id ?? null,
          name,
          actor_type: actorType,
          trigger_type: triggerType,
          condition,
          reward_type: rewardType,
          reward_value: Number(rewardValue) || 0,
          recurrence,
          valid_from: validFrom ? new Date(validFrom).toISOString() : null,
          valid_until: validUntil ? new Date(validUntil).toISOString() : null,
          is_active: isActive,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rewards"] });
      toast.success(program ? "Program updated" : "Program created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 grid place-items-center p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-[640px] p-6 space-y-4 my-8">
        <div className="flex items-center justify-between">
          <h3 className="text-[18px] font-bold">
            {program ? "Edit reward program" : "New reward program"}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>Program name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Refer 3 & get free booking"
            className={inputCls}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={labelCls}>Applies to</label>
            <select
              value={actorType}
              onChange={(e) => {
                setActorType(e.target.value);
                const first = triggers.find((t) => t.actor_types.includes(e.target.value));
                if (!triggers.find((t) => t.key === triggerType)?.actor_types.includes(e.target.value)) {
                  setTriggerType(first?.key ?? "");
                  setCondition({});
                }
              }}
              className={inputCls}
            >
              {ACTORS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Trigger</label>
            <select
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value);
                setCondition({});
              }}
              className={inputCls}
            >
              {triggers
                .filter((t) => t.actor_types.includes(actorType))
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {fields.length > 0 && (
          <div className="rounded-[14px] border border-border p-4 space-y-3">
            <p className={labelCls}>Conditions</p>
            <div className="grid grid-cols-2 gap-4">
              {fields.map((f) => (
                <div key={f.field} className="space-y-1.5">
                  <label className="text-[12px] text-muted-foreground">{f.label}</label>
                  {f.type === "select" ? (
                    <select
                      value={String(condition[f.field] ?? f.default ?? f.options?.[0] ?? "")}
                      onChange={(e) =>
                        setCondition((c) => ({ ...c, [f.field]: e.target.value }))
                      }
                      className={inputCls}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      value={String(condition[f.field] ?? f.default ?? "")}
                      onChange={(e) =>
                        setCondition((c) => {
                          const next = { ...c };
                          if (e.target.value === "") delete next[f.field];
                          else next[f.field] = Number(e.target.value);
                          return next;
                        })
                      }
                      className={inputCls}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className={labelCls}>Reward type</label>
            <select
              value={rewardType}
              onChange={(e) => setRewardType(e.target.value)}
              className={inputCls}
            >
              {REWARD_TYPES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Reward value</label>
            <input
              type="number"
              value={rewardValue}
              onChange={(e) => setRewardValue(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Recurrence</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className={inputCls}
            >
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={labelCls}>Valid from (optional)</label>
            <input
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Valid until (optional)</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="h-10 px-5 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save program"}
          </button>
        </div>
      </div>
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
