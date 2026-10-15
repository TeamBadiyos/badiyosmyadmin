import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardOverview } from "@/lib/finance.functions";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { supabase } from "@/integrations/supabase/client";
import { PipelineKanban, SERVICE_META, type BoardService } from "@/components/pipeline-kanban";
import type { StaffRole } from "@/lib/staff.functions";

type Range = "today" | "yesterday" | "7d" | "30d";
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
function rangeDates(r: Range) {
  const now = new Date(); const day = 86400000;
  const today = ist(now);
  if (r === "today") return { from: today, to: today };
  if (r === "yesterday") { const y = ist(new Date(now.getTime() - day)); return { from: y, to: y }; }
  return { from: ist(new Date(now.getTime() - (r === "7d" ? 6 : 29) * day)), to: today };
}
const inr = (n: unknown) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");

const ROWS: { key: BoardService; nav: string; live: boolean }[] = [
  { key: "maid", nav: "maid-bookings", live: false },
  { key: "wash", nav: "wash-bookings", live: false },
  { key: "store", nav: "store-orders", live: true },
  { key: "food", nav: "food-orders", live: true },
  { key: "parcel", nav: "courier-orders", live: true },
];

export function DashboardOverview({ role, onNavigate }: { role: StaffRole | null; onNavigate: (key: string) => void }) {
  const [range, setRange] = useState<Range>("today");
  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const fetch = useServerFn(getDashboardOverview);
  const fetchStats = useServerFn(getDashboardStats);
  const q = useQuery({ queryKey: ["dash-overview", from, to], queryFn: () => fetch({ data: { from, to } }), refetchInterval: 60_000 });
  const stats = useQuery({
    queryKey: ["dashboard", "stats", null],
    queryFn: () => fetchStats({ data: { segmentId: null } }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  }).data;
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

  const d = q.data as { services?: Record<string, Record<string, number | null>>; alerts?: Record<string, number> } | undefined;
  const a = d?.alerts ?? {};
  const approvals = Number(a.pending_products_store ?? 0) + Number(a.pending_products_food ?? 0);
  const alerts = [
    { n: approvals, label: "Approvals pending", nav: Number(a.pending_products_store ?? 0) > 0 ? "store-orders" : "food-orders" },
    { n: Number(a.refunds_failed ?? 0), label: "Refunds failed", nav: "fin-refunds" },
    { n: Number(a.instant_to_pay ?? 0), label: "Instant pay today", nav: "fin-instant" },
    { n: Number(a.carry_forward_merchants ?? 0), label: "Carry-forward merchants", nav: "fin-settlements" },
  ].filter((x) => x.n > 0);

  return (
    <div className="space-y-8 bg-background">
      <PipelineKanban role={role} unified />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]">
        <span className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Team right now</span>
        <span>Free maids <b className="text-foreground">{stats?.freeMaids ?? "—"}</b></span>
        <span>Free washers <b className="text-foreground">{stats?.freeWashers ?? "—"}</b></span>
        <span>Free riders <b className="text-foreground">{riders?.free ?? "—"}</b></span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] font-bold">Summary</p>
          <div className="inline-flex rounded-full border border-border p-0.5 text-[12px] font-bold">
            {([["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"]] as [Range, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 h-7 rounded-full ${range === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>
        {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-4 py-2.5 font-semibold">Service</th>
                <th className="px-4 py-2.5 font-semibold text-right">Orders</th>
                <th className="px-4 py-2.5 font-semibold text-right">Cancelled</th>
                <th className="px-4 py-2.5 font-semibold text-right">GMV</th>
                <th className="px-4 py-2.5 font-semibold text-right">badiyos earning</th>
                <th className="px-4 py-2.5 font-semibold text-right">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const v = d?.services?.[r.key] ?? {};
                const orders = Number(v.completed ?? 0) + Number(v.active ?? 0) + Number(v.cancelled ?? 0);
                return (
                  <tr key={r.key} onClick={() => onNavigate(r.nav)} className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/40">
                    <td className="px-4 py-3 font-semibold">
                      <span className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${SERVICE_META[r.key].dot}`} />{SERVICE_META[r.key].label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">{q.data ? orders : "—"}</td>
                    <td className="px-4 py-3 text-right">{v.cancelled ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{inr(v.gmv)}</td>
                    <td className="px-4 py-3 text-right">{inr(v.earning)}</td>
                    <td className="px-4 py-3 text-right">
                      {v.utilisation == null ? "—" : `${v.utilisation}%`}
                      {r.live && <span className="ml-1.5 rounded bg-primary/10 px-1.5 text-[10px] font-semibold uppercase text-primary">Live</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {alerts.map((x) => (
            <button key={x.label} onClick={() => onNavigate(x.nav)} className="text-destructive font-semibold hover:underline">
              {x.label} {x.n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
