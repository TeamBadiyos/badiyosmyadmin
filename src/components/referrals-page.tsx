import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X, Save, Undo2 } from "lucide-react";
import {
  getReferralConfig,
  updateReferralConfig,
  listReferrals,
  listReferralStatuses,
  reverseReferralReward,
  type ReferralRow,
} from "@/lib/referrals.functions";

export function ReferralsPage() {
  const [status, setStatus] = useState<string>("");
  const [reversing, setReversing] = useState<ReferralRow | null>(null);

  const fetchList = useServerFn(listReferrals);
  const fetchStatuses = useServerFn(listReferralStatuses);

  const { data: statuses = [] } = useQuery({
    queryKey: ["referrals", "statuses"],
    queryFn: () => fetchStatuses(),
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ["referrals", "list", status],
    queryFn: () => fetchList({ data: { status: status || null } }),
  });

  return (
    <div className="space-y-6">
      <ConfigCard />

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Filter status
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
        >
          <option value="">All</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_150px_130px_130px_100px_110px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Referrer</span>
          <span>Referred</span>
          <span>Status</span>
          <span className="text-right">Signup</span>
          <span className="text-right">First booking</span>
          <span className="text-right">Total</span>
          <span></span>
        </div>
        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {!isLoading && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            No referral transactions.
          </p>
        )}
        {data.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_150px_130px_130px_100px_110px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <UserCell name={r.referrer_name} phone={r.referrer_phone} />
            <UserCell name={r.referred_name} phone={r.referred_phone} />
            <span>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${statusBadge(
                  r.status,
                )}`}
              >
                {statusLabel(r.status)}
              </span>
              {r.reversal_reason && (
                <p className="text-[11px] text-muted-foreground mt-1 truncate">
                  Reason: {r.reversal_reason}
                </p>
              )}
            </span>
            <StepCell amount={r.signup_reward_amount} date={r.signup_reward_date} />
            <StepCell amount={r.booking_reward_amount} date={r.booking_reward_date} />
            <span className="text-right font-semibold">
              {r.signup_reward_amount + r.booking_reward_amount || r.reward_amount || "—"}
            </span>
            <div className="flex justify-end">
              {r.status === "reward_credited" && (
                <button
                  onClick={() => setReversing(r)}
                  className="h-9 px-3 rounded-[12px] border border-destructive/40 text-destructive font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-destructive/5"
                >
                  <Undo2 size={14} /> Reverse
                </button>
              )}
            </div>
          </div>
        ))}
      </div>


      {reversing && (
        <ReverseModal txn={reversing} onClose={() => setReversing(null)} />
      )}
    </div>
  );
}

function UserCell({ name, phone }: { name: string | null; phone: string | null }) {
  return (
    <div className="min-w-0">
      <p className="font-semibold text-foreground truncate">{name ?? "—"}</p>
      <p className="text-[12px] text-muted-foreground truncate">{phone ?? ""}</p>
    </div>
  );
}

function StepCell({ amount, date }: { amount: number; date: string | null }) {
  if (!amount) return <span className="text-right text-muted-foreground">—</span>;
  return (
    <span className="text-right">
      <span className="font-semibold">{amount}</span>
      <span className="block text-[11px] text-muted-foreground">
        {date ? new Date(date).toLocaleDateString() : ""}
      </span>
    </span>
  );
}

function statusLabel(status: string): string {
  if (status === "registered") return "Joined";
  if (status === "reward_credited") return "First booking done";
  return status.replace(/_/g, " ");
}

function statusBadge(status: string): string {
  if (status === "reward_credited") return "bg-primary-tint text-primary";
  if (status === "reversed") return "bg-destructive/10 text-destructive";
  if (status === "pending") return "bg-amber-100 text-amber-700";
  if (status === "registered") return "bg-sky-100 text-sky-700";
  return "bg-muted text-muted-foreground";
}


// ---------- Config ----------

function ConfigCard() {
  const queryClient = useQueryClient();
  const fetchCfg = useServerFn(getReferralConfig);
  const save = useServerFn(updateReferralConfig);

  const { data, isLoading } = useQuery({
    queryKey: ["referrals", "config"],
    queryFn: () => fetchCfg(),
  });

  const [signup, setSignup] = useState<string>("");
  const [booking, setBooking] = useState<string>("");
  const [mReferrals, setMReferrals] = useState<string>("");
  const [mReward, setMReward] = useState<string>("");
  const [active, setActive] = useState<boolean>(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // hydrate once loaded
  const hydrated = data
    ? signup === "" && !isLoading
      ? (setSignup(String(data.signup_reward_coins)),
        setBooking(String(data.booking_reward_coins)),
        setMReferrals(data.milestone_referrals == null ? "" : String(data.milestone_referrals)),
        setMReward(
          data.milestone_reward_coins == null ? "" : String(data.milestone_reward_coins),
        ),
        setActive(data.is_active),
        true)
      : true
    : false;
  void hydrated;

  const total = (Number(signup) || 0) + (Number(booking) || 0);

  const mutation = useMutation({
    mutationFn: () => {
      const s = Number(signup);
      const b = Number(booking);
      if (!(s >= 0) || !(b >= 0)) throw new Error("Rewards must be non-negative");
      return save({
        data: {
          signup_reward_coins: s,
          booking_reward_coins: b,
          milestone_referrals: mReferrals === "" ? null : Number(mReferrals),
          milestone_reward_coins: mReward === "" ? null : Number(mReward),
          is_active: active,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referrals", "config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="bg-card border border-border rounded-[18px] p-6">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Program settings
      </p>
      <h2 className="text-[18px] font-bold text-foreground">Referral rewards</h2>
      <p className="text-[13px] text-muted-foreground mt-1">
        Friend joins → signup points. Friend completes first booking → booking points.
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field
          label="Signup points (friend joins)"
          value={signup}
          onChange={setSignup}
        />
        <Field
          label="Booking points (first booking)"
          value={booking}
          onChange={setBooking}
        />
        <Field
          label="Milestone after N referrals"
          value={mReferrals}
          onChange={setMReferrals}
          placeholder="e.g. 5"
        />
        <Field
          label="Milestone bonus points"
          value={mReward}
          onChange={setMReward}
          placeholder="e.g. 50"
        />
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-4 items-center">
        <label className="flex items-center justify-between gap-3 p-3 rounded-[14px] border border-border">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Program enabled</p>
            <p className="text-[12px] text-muted-foreground">
              When disabled, no new rewards are credited automatically.
            </p>
          </div>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-5 h-5 accent-primary"
          />
        </label>
        <div className="px-4 py-3 rounded-[14px] bg-primary-tint">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
            Total per referral
          </p>
          <p className="text-[18px] font-bold text-primary">{total} points</p>
        </div>
        <button
          disabled={mutation.isPending}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
          className="h-11 px-4 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
        >
          <Save size={16} />
          {mutation.isPending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>
      {error && <p className="text-[13px] text-destructive mt-2">{error}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      />
    </div>
  );
}


// ---------- Reverse modal ----------

function ReverseModal({
  txn,
  onClose,
}: {
  txn: ReferralRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reverse = useServerFn(reverseReferralReward);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!reason.trim()) throw new Error("Reason required");
      return reverse({ data: { txn_id: txn.id, reason: reason.trim() } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referrals"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[480px] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-[18px] font-bold text-foreground">Reverse referral reward</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>
        <div className="px-6 py-6 space-y-4">
          <p className="text-[13px] text-muted-foreground">
            This will subtract{" "}
            <span className="font-semibold text-foreground">{txn.reward_amount} coins</span> from{" "}
            <span className="font-semibold text-foreground">{txn.referrer_name ?? "the referrer"}</span>{" "}
            and mark this transaction as reversed.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Reason
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="e.g. Fraudulent signup detected"
              className="px-3 py-2 rounded-[14px] border border-border bg-card text-[14px] resize-none"
            />
          </div>
          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[14px] border border-border font-semibold text-[14px]"
          >
            Cancel
          </button>
          <button
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            className="h-11 px-5 rounded-[14px] bg-destructive text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} /> {mutation.isPending ? "Reversing…" : "Confirm reversal"}
          </button>
        </footer>
      </div>
    </div>
  );
}
