import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { getDashboardOverview } from "@/lib/finance.functions";
import { supabase } from "@/integrations/supabase/client";
import { DiscountBreakdownModal } from "@/components/discount-breakdown-modal";
import { BookingDetailsModal } from "@/components/booking-details-modal";
import type { StaffRole } from "@/lib/staff.functions";

const inr = (n: unknown) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

/** The seven "today" KPI cards that used to sit on the Dashboard. */
export function DashboardKpis({ role }: { role: StaffRole | null }) {
  const fetchStats = useServerFn(getDashboardStats);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["dashboard", "stats", null],
    queryFn: () => fetchStats({ data: { segmentId: null } }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const riders = useQuery({
    queryKey: ["riders", "capacity", "dashboard"],
    queryFn: async () => {
      const { data: r, error } = await (supabase as unknown as { rpc: (n: string) => Promise<{ data: unknown; error: Error | null }> }).rpc("rider_pool_stats");
      if (error) throw error;
      const v = (r ?? {}) as { free?: number };
      return { free: Number(v.free ?? 0) };
    },
    refetchInterval: 30_000,
  }).data;

  const cards = [
    { label: "Total order value", value: inr(data?.grossToday), hint: "Before discounts · today" },
    { label: "Discount given", value: inr(data?.discountToday), hint: `All time ${inr(data?.discountGiven)}`, onClick: () => setDiscountOpen(true) },
    { label: "Actual revenue", value: inr(data?.todayRevenue), hint: `GST ${inr(data?.gstCollectedToday)}` },
    { label: "Active right now", value: String(data?.activeNow ?? "—"), hint: "In progress + being prepared" },
    { label: "Completed today", value: String(data?.completedToday ?? "—"), hint: "Bookings + orders" },
    { label: "Free riders", value: riders ? String(riders.free) : "—", hint: "Courier Delivery skill" },
    { label: "Free maids", value: String(data?.freeMaids ?? "—"), hint: "Online & free" },
  ];
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-bold text-foreground">Today at a glance</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={c.onClick} disabled={!c.onClick}
            className="text-left bg-card border border-border rounded-[14px] p-3 enabled:hover:border-primary/50 disabled:cursor-default">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="mt-2 text-[20px] font-bold text-foreground leading-none">{c.value}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground truncate">{c.hint}</p>
          </button>
        ))}
      </div>
      <DiscountBreakdownModal open={discountOpen} onClose={() => setDiscountOpen(false)} onOpenBooking={(id) => setBookingId(id)} />
      {bookingId && <BookingDetailsModal bookingId={bookingId} role={role} onClose={() => setBookingId(null)} />}
    </div>
  );
}

const SERIES = [
  { key: "maid", label: "Maid", color: "var(--svc-maid)" },
  { key: "wash", label: "Car/Bike Wash", color: "var(--svc-wash)" },
  { key: "store", label: "Store", color: "var(--svc-store)" },
  { key: "food", label: "Food", color: "var(--svc-food)" },
  { key: "parcel", label: "Parcel", color: "var(--svc-parcel)" },
];

/** Daily orders per service — grouped bars, one fixed colour per service. */
export function DailyOrdersChart() {
  const [days, setDays] = useState<7 | 30>(7);
  const { from, to } = useMemo(() => {
    const now = new Date();
    return { from: ist(new Date(now.getTime() - (days - 1) * 86400000)), to: ist(now) };
  }, [days]);
  const fetch = useServerFn(getDashboardOverview);
  const q = useQuery({ queryKey: ["dash-overview", from, to], queryFn: () => fetch({ data: { from, to } }) });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const daily = ((q.data as { daily?: unknown[] } | undefined)?.daily ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-bold">Daily orders per service</p>
        <div className="inline-flex rounded-full border border-border p-0.5 text-[12px] font-bold">
          {([7, 30] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 h-7 rounded-full ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{d} days</button>
          ))}
        </div>
      </div>
      <div className="h-64">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(x: string) => String(x).slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SERIES.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={14} />)}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
