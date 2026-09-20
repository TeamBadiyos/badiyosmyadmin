import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X } from "lucide-react";
import {
  upsertRewardProgram,
  type RewardProgram,
  type RewardTriggerType,
  type RewardCondition,
} from "@/lib/rewards.functions";

export const ACTORS = [
  { key: "customer", label: "Customer" },
  { key: "partner", label: "Expert / Partner" },
  { key: "merchant", label: "Merchant" },
] as const;

const REWARD_TYPES = ["coins", "cash"] as const;
const RECURRENCES = ["per_event", "once", "weekly", "monthly"] as const;

const inputCls =
  "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
const helpCls = "text-[11px] text-muted-foreground";

function num(v: unknown): string {
  return v === undefined || v === null || v === "" ? "" : String(v);
}

export function IncentiveProgramModal({
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

  const available = triggers.filter((t) => t.actor_types.includes(program?.actor_type ?? actor));

  const existing = (program?.condition ?? {}) as RewardCondition;

  const [name, setName] = useState(program?.name ?? "");
  const [actorType, setActorType] = useState(program?.actor_type ?? actor);
  const [triggerType, setTriggerType] = useState(program?.trigger_type ?? available[0]?.key ?? "");
  const [condition, setCondition] = useState<RewardCondition>(existing);
  const [rewardType, setRewardType] = useState(program?.reward_type ?? "cash");
  const [rewardValue, setRewardValue] = useState(String(program?.reward_value ?? 500));
  const [recurrence, setRecurrence] = useState(program?.recurrence ?? "per_event");
  const [validFrom, setValidFrom] = useState(program?.valid_from?.slice(0, 10) ?? "");
  const [validUntil, setValidUntil] = useState(program?.valid_until?.slice(0, 10) ?? "");
  const [isActive, setIsActive] = useState(program?.is_active ?? true);

  // Eligibility / limits (stored inside condition jsonb)
  const [tierGroup, setTierGroup] = useState(String(existing["tier_group"] ?? ""));
  const [minRating, setMinRating] = useState(num(existing["min_avg_rating"]));
  const [noComplaints, setNoComplaints] = useState(existing["no_complaints"] === true);
  const [requireOnTime, setRequireOnTime] = useState(existing["require_on_time"] === true);
  const [monthlyBudget, setMonthlyBudget] = useState(num(existing["monthly_budget"]));

  const trig = triggers.find((t) => t.key === triggerType);
  const fields = (trig?.condition_schema ?? []).filter(
    (f) =>
      !["tier_group", "min_avg_rating", "no_complaints", "require_on_time", "monthly_budget"].includes(
        f.field,
      ),
  );

  function buildCondition(): RewardCondition {
    const next: RewardCondition = { ...condition };
    delete next["tier_group"];
    delete next["min_avg_rating"];
    delete next["no_complaints"];
    delete next["require_on_time"];
    delete next["monthly_budget"];
    if (tierGroup.trim()) next["tier_group"] = tierGroup.trim();
    if (minRating !== "") next["min_avg_rating"] = Number(minRating);
    if (noComplaints) next["no_complaints"] = true;
    if (requireOnTime) next["require_on_time"] = true;
    if (monthlyBudget !== "") next["monthly_budget"] = Number(monthlyBudget);
    return next;
  }

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: program?.id ?? null,
          name,
          actor_type: actorType,
          trigger_type: triggerType,
          condition: buildCondition(),
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
      toast.success(program ? "Incentive updated" : "Incentive created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 grid place-items-center p-4 overflow-y-auto">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-[680px] p-6 space-y-4 my-8">
        <div className="flex items-center justify-between">
          <h3 className="text-[18px] font-bold">
            {program ? "Edit incentive plan" : "New incentive plan"}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className={labelCls}>Plan name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly bonus 25 hours"
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
            <label className={labelCls}>Earned on</label>
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
            {trig?.description && <p className={helpCls}>{trig.description}</p>}
          </div>
        </div>

        {fields.length > 0 && (
          <div className="rounded-[14px] border border-border p-4 space-y-3">
            <p className={labelCls}>Target</p>
            <div className="grid grid-cols-2 gap-4">
              {fields.map((f) => (
                <div key={f.field} className="space-y-1.5">
                  <label className="text-[12px] text-muted-foreground">{f.label}</label>
                  {f.type === "select" ? (
                    <select
                      value={String(condition[f.field] ?? f.default ?? f.options?.[0] ?? "")}
                      onChange={(e) => setCondition((c) => ({ ...c, [f.field]: e.target.value }))}
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

        <div className="rounded-[14px] border border-border p-4 space-y-3">
          <p className={labelCls}>Eligibility &amp; limits</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[12px] text-muted-foreground">Slab group (optional)</label>
              <input
                value={tierGroup}
                onChange={(e) => setTierGroup(e.target.value)}
                placeholder="weekly_hours"
                className={inputCls}
              />
              <p className={helpCls}>
                Same group ke plans me se sirf sabse ooncha slab hi milega (e.g. 25/30/35/50 hours).
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] text-muted-foreground">Minimum average rating</label>
              <input
                type="number"
                step="0.1"
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                placeholder="4"
                className={inputCls}
              />
              <p className={helpCls}>Khaali chhodenge to rating check nahi hoga.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] text-muted-foreground">Monthly budget cap (₹, optional)</label>
              <input
                type="number"
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(e.target.value)}
                placeholder="50000"
                className={inputCls}
              />
              <p className={helpCls}>
                Cap cross hone par payout rukta hai aur Super Admin approval ke liye log hota hai.
              </p>
            </div>
            <div className="space-y-2 pt-6">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={noComplaints}
                  onChange={(e) => setNoComplaints(e.target.checked)}
                />
                No expert-fault complaint in the period
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={requireOnTime}
                  onChange={(e) => setRequireOnTime(e.target.checked)}
                />
                On-time arrival required (15 min grace)
              </label>
            </div>
          </div>
        </div>

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
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Amount</label>
            <input
              type="number"
              value={rewardValue}
              onChange={(e) => setRewardValue(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>How often</label>
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
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="h-10 px-5 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
