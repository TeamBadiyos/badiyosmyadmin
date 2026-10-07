import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { getHandoverInfo, handoverBookingExpert } from "@/lib/handover.functions";
import { listActiveExperts } from "@/lib/live-orders.functions";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function ExpertHandoverPanel({
  bookingId,
  status,
  startedAt,
  durationMinutes,
  currentExpertName,
  canEdit,
}: {
  bookingId: string;
  status: string;
  startedAt: string | null;
  durationMinutes: number | null;
  currentExpertName: string | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const infoFn = useServerFn(getHandoverInfo);
  const expertsFn = useServerFn(listActiveExperts);
  const doFn = useServerFn(handoverBookingExpert);
  const [open, setOpen] = useState(false);
  const [expertId, setExpertId] = useState("");
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState("");

  const info = useQuery({
    queryKey: ["bookings", "handover", bookingId],
    queryFn: () => infoFn({ data: { bookingId } }),
  });
  const experts = useQuery({
    queryKey: ["bookings", "handover-experts", bookingId],
    queryFn: () => expertsFn({ data: { bookingId } }),
    enabled: open,
  });

  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)) : 0;
  const total = durationMinutes ?? 60;
  const suggested = useMemo(() => {
    const rem = info.data?.remaining ?? 0;
    const tp = info.data?.totalPayout ?? 0;
    return Math.min(rem, Math.round((tp * Math.min(elapsed, total)) / Math.max(total, 1)));
  }, [info.data, elapsed, total]);

  const list = (experts.data ?? []).filter((e) => {
    const q = search.trim().toLowerCase();
    return !q || e.name.toLowerCase().includes(q) || (e.phone ?? "").includes(q);
  });

  const amt = amount === "" ? suggested : Number(amount);
  const remaining = info.data?.remaining ?? 0;

  const m = useMutation({
    mutationFn: () => doFn({ data: { bookingId, newExpertId: expertId, previousPayout: amt, reason } }),
    onSuccess: (r) => {
      toast.success(`Handover done. ${inr(r.previous_payout)} credited now, ${inr(r.remaining_payout)} on completion.`);
      setOpen(false); setExpertId(""); setAmount(""); setReason(""); setSearch("");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Handover failed"),
  });

  const history = info.data?.history ?? [];
  const canHandover = canEdit && status === "in_progress";
  if (!canHandover && history.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-[13px] font-bold flex items-center gap-1.5">
          <ArrowRightLeft size={14} /> Expert handover
        </h4>
        {canHandover && !open && (
          <button onClick={() => setOpen(true)} className="text-[12px] font-bold text-primary hover:underline">
            Change expert mid-service
          </button>
        )}
      </div>

      {history.length > 0 && (
        <ul className="space-y-1.5">
          {history.map((h) => (
            <li key={h.id} className="text-[12px] rounded-lg bg-muted px-2.5 py-1.5">
              <b>{h.previousExpertName ?? "—"}</b> → <b>{h.newExpertName ?? "—"}</b> · worked {Math.floor(h.minutesWorked / 60)}h {h.minutesWorked % 60}m · paid {inr(h.previousPayout)}
              <div className="text-muted-foreground">{new Date(h.createdAt).toLocaleString("en-IN")} · {h.reason}</div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
            <Stat label="Current" value={currentExpertName ?? "—"} />
            <Stat label="Worked" value={`${Math.floor(elapsed / 60)}h ${elapsed % 60}m of ${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ""}`} />
            <Stat label="Total expert pay" value={inr(info.data?.totalPayout ?? 0)} />
            <Stat label="Remaining" value={inr(remaining)} />
          </div>

          <div>
            <label className="text-[12px] font-semibold">Pay {currentExpertName ?? "current expert"} now (₹)</label>
            <input type="number" min={0} max={remaining} value={amount === "" ? String(suggested) : amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
            <p className="text-[11px] text-muted-foreground mt-1">
              Suggested by time worked. New expert gets {inr(Math.max(remaining - (amt || 0), 0))} on completion.
            </p>
          </div>

          <div>
            <label className="text-[12px] font-semibold">New expert</label>
            <input placeholder="Search name / phone" value={search} onChange={(e) => setSearch(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {experts.isLoading && <p className="text-[12px] text-muted-foreground">Loading…</p>}
              {!experts.isLoading && list.length === 0 && <p className="text-[12px] text-muted-foreground">No free experts available.</p>}
              {list.map((e) => (
                <button key={e.id} onClick={() => setExpertId(e.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 text-[12px] ${expertId === e.id ? "border-primary bg-primary/10" : "border-border"}`}>
                  <b>{e.name}</b> <span className="text-muted-foreground">{e.phone}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold">Reason (required)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="e.g. Maid emergency / customer requested change"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-2 text-[12px] font-semibold">Cancel</button>
            <button
              disabled={!expertId || reason.trim().length < 3 || !(amt >= 0) || amt > remaining || m.isPending}
              onClick={() => {
                if (confirm(`${currentExpertName ?? "Current expert"} will be freed and credited ${inr(amt)} now. Continue?`)) m.mutate();
              }}
              className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-[12px] font-bold disabled:opacity-50">
              {m.isPending ? "Saving…" : "Confirm handover"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-2.5 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold truncate">{value}</div>
    </div>
  );
}
