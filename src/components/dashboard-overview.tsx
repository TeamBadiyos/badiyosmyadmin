import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { getDashboardOverview } from "@/lib/finance.functions";
import { listCommercePipeline } from "@/lib/commerce.functions";

type Range = "today" | "yesterday" | "7d" | "30d";
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
function rangeDates(r: Range) {
  const now = new Date(); const day = 86400000;
  const today = ist(now);
  if (r === "today") return { from: today, to: today };
  if (r === "yesterday") { const y = ist(new Date(now.getTime() - day)); return { from: y, to: y }; }
  return { from: ist(new Date(now.getTime() - (r === "7d" ? 6 : 29) * day)), to: today };
}
const inr = (n: any) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");

const SERVICES = [
  { key: "maid", label: "Maid / Home Care", nav: "maid-bookings", color: "hsl(var(--primary))" },
  { key: "wash", label: "Car / Bike Wash", nav: "wash-bookings", color: "hsl(var(--chart-2, 200 70% 50%))" },
  { key: "store", label: "Store", nav: "store-orders", color: "hsl(var(--chart-3, 30 80% 55%))" },
  { key: "food", label: "Food", nav: "food-orders", color: "hsl(var(--chart-4, 340 70% 55%))" },
  { key: "parcel", label: "Parcel", nav: "courier-orders", color: "hsl(var(--chart-5, 150 60% 40%))" },
] as const;

export function DashboardOverview({ onNavigate }: { onNavigate: (key: string) => void }) {
  const [range, setRange] = useState<Range>("today");
  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const fetch = useServerFn(getDashboardOverview);
  const pipe = useServerFn(listCommercePipeline);
  const q = useQuery({ queryKey: ["dash-overview", from, to], queryFn: () => fetch({ data: { from, to } }), refetchInterval: 60_000 });
  const stuck = useQuery({
    queryKey: ["dash-stuck"],
    queryFn: () => pipe({ data: { service: null } }),
    refetchInterval: 30_000,
  });
  const stuckCount = ((stuck.data as any)?.orders ?? []).filter((o: any) => (o.alerts ?? []).length > 0).length;
  const d = q.data as any;
  const a = d?.alerts ?? {};
  const alerts: { n: number | boolean; label: string; nav: string }[] = [
    { n: stuckCount, label: `${stuckCount} stuck order${stuckCount === 1 ? "" : "s"}`, nav: "live-board" },
    { n: a.pending_products_store ?? 0, label: `${a.pending_products_store} Store product approvals`, nav: "store-orders" },
    { n: a.pending_products_food ?? 0, label: `${a.pending_products_food} Food product approvals`, nav: "food-orders" },
    { n: a.instant_to_pay ?? 0, label: `${a.instant_to_pay} instant settlements to pay today`, nav: "fin-instant" },
    { n: a.refunds_failed ?? 0, label: `${a.refunds_failed} refunds failed — needs action`, nav: "fin-refunds" },
    { n: a.carry_forward_merchants ?? 0, label: `${a.carry_forward_merchants} merchants with carry-forward balance`, nav: "fin-settlements" },
    { n: !!a.all_riders_busy, label: "All riders busy right now", nav: "courier-riders" },
  ].filter((x) => (typeof x.n === "boolean" ? x.n : x.n > 0));

  return (
    <div className="space-y-4 mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Services overview</h2>
        <div className="flex gap-1">
          {([["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"]] as [Range, string][]).map(([k, l]) => (
            <Button key={k} size="sm" variant={range === k ? "default" : "outline"} onClick={() => setRange(k)}>{l}</Button>
          ))}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.map((x) => (
            <button key={x.label} onClick={() => onNavigate(x.nav)}
              className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20">
              <AlertTriangle size={12} /> {x.label}
            </button>
          ))}
        </div>
      )}

      {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {SERVICES.map((s) => {
          const v = d?.services?.[s.key] ?? {};
          const n = v.notify ?? {};
          return (
            <button key={s.key} onClick={() => onNavigate(s.nav)} className="text-left rounded-xl border bg-card p-4 hover:border-primary transition-colors">
              <p className="text-sm font-semibold">{s.label}</p>
              <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                <div><p className="text-lg font-bold">{v.completed ?? "—"}</p><p className="text-[10px] text-muted-foreground">Completed</p></div>
                <div><p className="text-lg font-bold">{v.active ?? "—"}</p><p className="text-[10px] text-muted-foreground">Active now</p></div>
                <div><p className="text-lg font-bold">{v.cancelled ?? "—"}</p><p className="text-[10px] text-muted-foreground">Cancel/Reject</p></div>
              </div>
              <div className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">GMV</span><span className="font-semibold">{inr(v.gmv)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Badiyos earning</span><span className="font-semibold">{inr(v.earning)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1">{s.key === "maid" || s.key === "wash" ? "Slot utilisation" : <>Riders busy <span className="rounded bg-primary/10 px-1.5 text-[10px] font-semibold uppercase text-primary">Live</span></>}</span><span className="font-semibold">{v.utilisation == null ? "—" : `${v.utilisation}%`}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Notify me</span><span className="font-semibold">{n.tried ?? 0} / {n.notified ?? 0} / {n.converted ?? 0}</span></div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">Notify me = tried / notified / converted. Earning excludes GST. Rider utilisation is live (busy ÷ online riders with the Courier Delivery skill).</p>

      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm font-semibold mb-2">Daily orders per service</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d?.daily ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(x: string) => x.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SERVICES.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
