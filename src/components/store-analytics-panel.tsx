import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3 } from "lucide-react";
import { getStoreAnalytics } from "@/lib/merchants.functions";

export function StoreAnalyticsPanel({ merchantId }: { merchantId: string }) {
  const [days, setDays] = useState(7);
  const fetchA = useServerFn(getStoreAnalytics);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["merchants", "analytics", merchantId, days],
    queryFn: () => fetchA({ data: { merchantId, days } }),
    staleTime: 30_000,
  });
  const conv = data && data.uniqueVisitors ? ((data.orderingCustomers / data.uniqueVisitors) * 100).toFixed(1) : "0";
  const fmt = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="bg-card border border-border rounded-[18px] p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[16px] font-bold text-foreground flex items-center gap-2">
          <BarChart3 size={18} className="text-primary" /> Store analysis
        </h3>
        <div className="flex gap-1">
          {[1, 7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`h-8 px-3 rounded-[10px] text-[12px] font-semibold border ${days === d ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card"}`}>
              {d === 1 ? "Today" : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {isError && <p className="text-[13px] text-destructive">Could not load analysis.</p>}
      {data && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Kpi label="Total visits" v={data.totalVisits} />
            <Kpi label="Unique visitors" v={data.uniqueVisitors} />
            <Kpi label="Today" v={data.todayVisits} sub={`Yesterday ${data.yesterdayVisits}`} />
            <Kpi label="Orders" v={data.orders} sub={`${data.orderingCustomers} customers`} />
            <Kpi label="Conversion" v={`${conv}%`} sub="ordering / unique visitors" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Daily</p>
              <table className="w-full text-[13px]">
                <thead><tr className="text-muted-foreground text-left"><th className="py-1">Date</th><th>Visits</th><th>Unique</th><th>Orders</th></tr></thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date} className="border-t border-border">
                      <td className="py-1">{new Date(d.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                      <td>{d.visits}</td><td>{d.unique}</td><td>{d.orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Recent visitors</p>
              {data.recent.length === 0 ? <p className="text-[13px] text-muted-foreground">No visits yet.</p> : (
                <div className="space-y-1 max-h-[320px] overflow-y-auto">
                  {data.recent.map((r, i) => (
                    <div key={i} className="flex justify-between gap-2 text-[13px] border-t border-border py-1">
                      <span>
                        <span className="font-semibold">{r.guest ? "Guest" : r.name || "Customer"}</span>
                        {r.phone && <span className="block text-[11px] text-muted-foreground font-mono">{r.phone}</span>}
                      </span>
                      <span className="text-muted-foreground text-[12px]">{fmt(r.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, v, sub }: { label: string; v: number | string; sub?: string }) {
  return (
    <div className="rounded-[14px] border border-border p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">{label}</p>
      <p className="text-[20px] font-bold text-foreground">{v}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
