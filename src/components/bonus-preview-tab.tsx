import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PlayCircle, Download } from "lucide-react";
import { previewRewardPeriod, type RewardPreviewRow } from "@/lib/rewards.functions";

const inputCls =
  "h-10 w-full px-3 rounded-[12px] border border-border bg-card text-[13px] outline-none focus:border-primary";
const labelCls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const CATEGORY_LABEL: Record<string, string> = {
  weekly_hours: "Weekly hours",
  monthly_hours: "Monthly hours",
  active_bonus: "Active bonus",
  standalone: "Standalone",
};

function defaultStart(period: "weekly" | "monthly"): string {
  const now = new Date();
  if (period === "monthly") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.toISOString().slice(0, 10);
  }
  const day = now.getDay(); // 0 = Sunday
  const mondayOffset = (day + 6) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset - 7);
  return d.toISOString().slice(0, 10);
}

export function BonusPreviewTab() {
  const [period, setPeriod] = useState<"weekly" | "monthly">("monthly");
  const [start, setStart] = useState(() => defaultStart("monthly"));
  const [onlyQualified, setOnlyQualified] = useState(false);
  const [rows, setRows] = useState<RewardPreviewRow[] | null>(null);

  const runFn = useServerFn(previewRewardPeriod);

  const run = useMutation({
    mutationFn: () => runFn({ data: { period, period_start: start } }),
    onSuccess: (r) => {
      setRows(r);
      toast.success(`Preview ready — ${r.filter((x) => x.qualifies).length} bonus(es) would be paid`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shown = useMemo(
    () => (rows ?? []).filter((r) => (onlyQualified ? r.qualifies : true)),
    [rows, onlyQualified],
  );

  const totals = useMemo(() => {
    const q = (rows ?? []).filter((r) => r.qualifies);
    return {
      count: q.length,
      experts: new Set(q.map((r) => r.expert_id)).size,
      amount: q.reduce((s, r) => s + r.amount, 0),
    };
  }, [rows]);

  const exportCsv = () => {
    const head = [
      "Expert",
      "Hours",
      "Active days",
      "Orders",
      "Category",
      "Plan",
      "Target",
      "Amount",
      "Qualifies",
      "Reason",
    ];
    const body = shown.map((r) => [
      r.expert_name ?? r.expert_id,
      r.hours,
      r.active_days,
      r.orders,
      CATEGORY_LABEL[r.category] ?? r.category,
      r.program_name,
      r.slab,
      r.amount,
      r.qualifies ? "Yes" : "No",
      r.reason ?? "",
    ]);
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bonus-preview-${period}-${start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground max-w-[640px]">
        Dry run only — this shows who would earn which bonus for the chosen period. Nothing is
        credited and no wallet changes.
      </p>

      <div className="bg-card border border-border rounded-[18px] p-5 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <label className={labelCls}>Period</label>
          <select
            value={period}
            onChange={(e) => {
              const p = e.target.value as "weekly" | "monthly";
              setPeriod(p);
              setStart(defaultStart(p));
              setRows(null);
            }}
            className={inputCls}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Period start</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputCls}
          />
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-semibold text-[13px] inline-flex items-center gap-2 disabled:opacity-60"
        >
          <PlayCircle size={16} /> {run.isPending ? "Calculating…" : "Run preview"}
        </button>
        {rows && (
          <button
            onClick={exportCsv}
            className="h-10 px-4 rounded-[12px] border border-border font-semibold text-[13px] inline-flex items-center gap-2 hover:bg-muted"
          >
            <Download size={16} /> Export CSV
          </button>
        )}
      </div>

      {rows && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Experts getting a bonus", value: String(totals.experts) },
              { label: "Bonuses", value: String(totals.count) },
              { label: "Total amount", value: inr.format(totals.amount) },
            ].map((c) => (
              <div key={c.label} className="bg-card border border-border rounded-[18px] p-5">
                <p className={labelCls}>{c.label}</p>
                <p className="text-[22px] font-bold mt-1">{c.value}</p>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={onlyQualified}
              onChange={(e) => setOnlyQualified(e.target.checked)}
            />
            Show only experts who get a bonus
          </label>

          <div className="bg-card border border-border rounded-[18px] overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1.2fr)_90px_90px_80px_130px_minmax(0,1.2fr)_100px_minmax(0,1.3fr)] gap-3 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Expert</span>
              <span className="text-right">Hours</span>
              <span className="text-right">Days</span>
              <span className="text-right">Orders</span>
              <span>Category</span>
              <span>Plan</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
            </div>
            {shown.length === 0 && (
              <p className="text-[13px] text-muted-foreground text-center py-10">
                No rows for this period.
              </p>
            )}
            {shown.map((r, i) => (
              <div
                key={`${r.program_id}-${r.expert_id}-${i}`}
                className="grid grid-cols-[minmax(0,1.2fr)_90px_90px_80px_130px_minmax(0,1.2fr)_100px_minmax(0,1.3fr)] gap-3 items-center px-6 py-3 border-b border-border last:border-b-0 text-[13px]"
              >
                <span className="truncate font-semibold">{r.expert_name ?? "—"}</span>
                <span className="text-right">{r.hours}</span>
                <span className="text-right">{r.active_days}</span>
                <span className="text-right">{r.orders}</span>
                <span className="text-muted-foreground">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
                <span className="truncate">{r.program_name}</span>
                <span className="text-right font-semibold">
                  {r.qualifies ? inr.format(r.amount) : "—"}
                </span>
                <span
                  className={`truncate ${r.qualifies ? "text-primary font-semibold" : "text-muted-foreground"}`}
                >
                  {r.qualifies ? "Will get bonus" : (r.reason ?? "Not eligible")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
