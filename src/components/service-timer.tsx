import { useEffect, useState } from "react";
import { Timer, AlertTriangle } from "lucide-react";

/** Ticks once a second while mounted. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function clock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0
    ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function short(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (hh > 0) return `${hh}h ${mm}m`;
  if (mm > 0) return `${mm}m`;
  return `${s}s`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type TimerInput = {
  status: string;
  startedAt: string | null;
  serviceEndAt: string | null;
  serviceDurationMinutes?: number | null;
};

function useTimerState(b: TimerInput) {
  const active = b.status === "in_progress" && !!b.startedAt;
  const now = useNow(active);
  if (!active || !b.startedAt) return null;
  const startMs = Date.parse(b.startedAt);
  const endMs = b.serviceEndAt
    ? Date.parse(b.serviceEndAt)
    : b.serviceDurationMinutes
      ? startMs + b.serviceDurationMinutes * 60_000
      : null;
  if (!endMs) return null;
  const remainingSec = Math.floor((endMs - now) / 1000);
  const totalSec = Math.max(1, Math.floor((endMs - startMs) / 1000));
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const overtime = remainingSec < 0;
  return {
    startMs,
    endMs,
    remainingSec,
    overtimeSec: overtime ? -remainingSec : 0,
    overtime,
    progress: Math.max(0, Math.min(1, elapsedSec / totalSec)),
  };
}

/** Big live countdown shown inside the booking detail view. */
export function ServiceTimerCard({
  booking,
  extensionMinutes = 0,
}: {
  booking: TimerInput;
  extensionMinutes?: number;
}) {
  const t = useTimerState(booking);
  if (!t) return null;

  const tone = t.overtime
    ? {
        wrap: "border-red-200 bg-red-50",
        label: "text-red-700",
        value: "text-red-700",
        bar: "bg-red-500",
        sub: "text-red-700/80",
      }
    : t.remainingSec <= 300
      ? {
          wrap: "border-amber-200 bg-amber-50",
          label: "text-amber-800",
          value: "text-amber-800",
          bar: "bg-amber-500",
          sub: "text-amber-800/80",
        }
      : {
          wrap: "border-primary/30 bg-primary-tint",
          label: "text-primary",
          value: "text-primary",
          bar: "bg-primary",
          sub: "text-primary/80",
        };

  return (
    <section className={`rounded-[18px] border p-4 ${tone.wrap}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {t.overtime ? (
            <AlertTriangle size={16} className={tone.label} />
          ) : (
            <Timer size={16} className={tone.label} />
          )}
          <p
            className={`text-[11px] font-bold uppercase tracking-wide ${tone.label}`}
          >
            {t.overtime ? "Overtime" : "Time remaining"}
          </p>
          {extensionMinutes > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-50 text-indigo-700">
              +{extensionMinutes} min extension
            </span>
          )}
        </div>
        <p className={`font-mono text-[34px] font-bold leading-none ${tone.value}`}>
          {t.overtime ? `+${clock(t.overtimeSec)}` : clock(t.remainingSec)}
        </p>
      </div>

      <div className="mt-3 h-2 w-full rounded-full bg-foreground/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${tone.bar}`}
          style={{ width: `${Math.round(t.progress * 100)}%` }}
        />
      </div>

      <p className={`mt-2 text-[12px] font-semibold ${tone.sub}`}>
        Started {fmtTime(new Date(t.startMs).toISOString())} · Expected end{" "}
        {fmtTime(new Date(t.endMs).toISOString())}
      </p>
    </section>
  );
}

/** Compact live pill for list rows. */
export function ServiceTimerPill({ booking }: { booking: TimerInput }) {
  const t = useTimerState(booking);
  if (!t) return null;
  const cls = t.overtime
    ? "bg-red-50 text-red-700"
    : t.remainingSec <= 300
      ? "bg-amber-50 text-amber-700"
      : "bg-primary-tint text-primary";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${cls}`}
    >
      <Timer size={10} />
      {t.overtime ? `+${short(t.overtimeSec)} over` : `${short(t.remainingSec)} left`}
    </span>
  );
}
