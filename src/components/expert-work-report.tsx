import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExpertWorkReport } from "@/lib/experts.functions";

const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  d.setDate(d.getDate() + n);
  return fmtDay.format(d);
}
function presets() {
  const today = fmtDay.format(new Date());
  const dow = new Date(`${today}T12:00:00+05:30`).getDay(); // 0 Sun
  const monday = addDays(today, -((dow + 6) % 7));
  return {
    this_week: { from: monday, to: today, label: "This week" },
    last_week: { from: addDays(monday, -7), to: addDays(monday, -1), label: "Last week" },
    this_month: { from: `${today.slice(0, 8)}01`, to: today, label: "This month" },
    last_month: (() => {
      const first = `${today.slice(0, 8)}01`;
      const lastEnd = addDays(first, -1);
      return { from: `${lastEnd.slice(0, 8)}01`, to: lastEnd, label: "Last month" };
    })(),
  } as const;
}
const hrs = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export function ExpertWorkReport({ expertId }: { expertId: string }) {
  const P = useMemo(presets, []);
  const [preset, setPreset] = useState<keyof typeof P | "custom">("this_week");
  const [from, setFrom] = useState<string>(P.this_week.from);
  const [to, setTo] = useState<string>(P.this_week.to);
  const fetchReport = useServerFn(getExpertWorkReport);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["experts", "work-report", expertId, from, to],
    queryFn: () => fetchReport({ data: { expertId, from, to } }),
    enabled: from <= to,
  });

  const pick = (k: keyof typeof P) => {
    setPreset(k);
    setFrom(P[k].from);
    setTo(P[k].to);
  };

  // Weekly slabs for week ranges, monthly otherwise.
  const span = (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1;
  const period = span <= 7 ? "weekly" : "monthly";
  const slabs = (data?.slabs ?? []).filter((s) => s.period === period);
  const paidH = (data?.paidMinutes ?? 0) / 60;
  const achieved = [...slabs].reverse().find((s) => paidH >= s.hours) ?? null;
  const next = slabs.find((s) => paidH < s.hours) ?? null;

  return (
    <section className="bg-background border border-border rounded-[18px] p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          Work hours, orders & bonus
        </h3>
        <div className="flex flex-wrap gap-1.5 items-center">
          {(Object.keys(P) as (keyof typeof P)[]).map((k) => (
            <button
              key={k}
              onClick={() => pick(k)}
              className={`h-8 px-3 rounded-full text-[12px] font-bold border ${preset === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:bg-muted"}`}
            >
              {P[k].label}
            </button>
          ))}
          <input type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} className="h-8 px-2 rounded-[10px] border border-border bg-card text-[12px]" />
          <span className="text-muted-foreground text-[12px]">to</span>
          <input type="date" value={to} min={from} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} className="h-8 px-2 rounded-[10px] border border-border bg-card text-[12px]" />
        </div>
      </div>

      {isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {isError && <p className="text-[13px] text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Paid work hours" value={hrs(data.paidMinutes)} strong />
            <Stat label="Training hours (not counted)" value={hrs(data.trainingMinutes)} />
            <Stat label="Completed orders" value={String(data.completedCount)} />
            <Stat label="Avg rating" value={data.avgRating != null ? `★ ${data.avgRating}` : "—"} />
          </div>

          <div className="rounded-[14px] border border-border p-3 space-y-2">
            <p className="text-[11px] font-bold uppercase text-muted-foreground">
              {period === "weekly" ? "Weekly" : "Monthly"} bonus slabs
            </p>
            {slabs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No active {period} hour slabs.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slabs.map((s) => {
                  const ok = paidH >= s.hours;
                  const top = achieved?.id === s.id;
                  return (
                    <span key={s.id} className={`px-3 py-1.5 rounded-[12px] text-[12px] font-bold border ${top ? "bg-primary text-primary-foreground border-primary" : ok ? "border-primary/40 bg-primary/5 text-foreground" : "border-border text-muted-foreground"}`}>
                      {s.hours}h → {inr.format(s.value)} {top ? "✓ qualifies" : ok ? "✓" : ""}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-[13px] text-foreground">
              {achieved ? <>Top slab reached: <b>{achieved.hours}h ({inr.format(achieved.value)})</b>. </> : "No slab reached yet. "}
              {next && <>Next: <b>{next.hours}h</b> — {hrs(Math.max(0, Math.round(next.hours * 60 - data.paidMinutes)))} more.</>}
            </p>
            <p className="text-[11px] text-muted-foreground">Only the top slab is paid once per period. Training orders are excluded. Rating/complaint rules still apply at payout time.</p>
            {data.bonuses.length > 0 && (
              <div className="pt-1 space-y-1">
                <p className="text-[11px] font-bold uppercase text-muted-foreground">Bonuses in this range</p>
                {data.bonuses.map((b) => (
                  <div key={b.id} className="flex justify-between gap-2 text-[13px]">
                    <span>{b.name} <span className="text-muted-foreground">· {b.notes ?? b.ref}</span></span>
                    <span className="font-bold">{inr.format(b.value)} <span className="text-[11px] uppercase text-muted-foreground">{b.status}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.daily.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1.5">Day-wise hours</p>
              <div className="flex flex-wrap gap-1.5">
                {data.daily.map((d) => (
                  <span key={d.date} className="px-2.5 py-1 rounded-[10px] border border-border text-[12px]">
                    {dmy(d.date)}: <b>{hrs(d.minutes)}</b> · {d.orders} order{d.orders === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted-foreground uppercase text-[10px] tracking-wide border-b border-border">
                  <th className="py-2 pr-2">#</th><th className="pr-2">Work date</th><th className="pr-2">Slot</th>
                  <th className="pr-2">Customer</th><th className="pr-2">Service</th><th className="pr-2">Hours</th>
                  <th className="pr-2">Type</th><th className="pr-2">Status</th><th className="pr-2">Rating</th><th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.length === 0 && (
                  <tr><td colSpan={10} className="py-3 text-muted-foreground">No orders in this range.</td></tr>
                )}
                {data.orders.map((o, i) => (
                  <tr key={o.id} className={`border-b border-border/60 ${o.isTraining || o.status !== "completed" ? "text-muted-foreground" : ""}`}>
                    <td className="py-1.5 pr-2">{i + 1}</td>
                    <td className="pr-2 whitespace-nowrap">{dmy(o.workDate)}</td>
                    <td className="pr-2 whitespace-nowrap">{o.slot ?? "Instant"}</td>
                    <td className="pr-2">{o.customerName ?? (o.isTraining ? "Training" : "—")}{o.customerPhone ? <span className="block text-[11px] text-muted-foreground">{o.customerPhone}</span> : null}</td>
                    <td className="pr-2">{o.service ?? "—"}</td>
                    <td className="pr-2 whitespace-nowrap font-bold">{hrs(o.minutes + o.extensionMinutes)}{o.extensionMinutes ? <span className="text-[11px] font-normal"> (+{o.extensionMinutes}m ext)</span> : null}</td>
                    <td className="pr-2">{o.isTraining ? "Training" : o.isAdvance ? "Advance" : "Same day"}</td>
                    <td className="pr-2 capitalize">{o.status.replace(/_/g, " ")}</td>
                    <td className="pr-2">{o.rating ? `★ ${o.rating}` : "—"}</td>
                    <td>{o.payout != null ? inr.format(o.payout) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-[14px] border p-3 ${strong ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="text-[16px] font-bold text-foreground">{value}</p>
    </div>
  );
}
