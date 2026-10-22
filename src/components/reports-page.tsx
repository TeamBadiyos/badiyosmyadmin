import { DashboardKpis, DailyOrdersChart } from "@/components/dashboard-kpis";
import { DateInput } from "@/components/date-input";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  getRevenueReport,
  getBookingsReport,
  getBookingsDrilldown,
  getEntityDrilldown,
  getExpertPerformance,
  getReferralReport,
  getPayoutReport,
  getCustomerReport,
  getPnlReport,
  getRiderReport,
  getStoreReport,
  getPayoutOverview,
  getServiceReport,
  getMaidWorkReport,
  type ReportRange,
} from "@/lib/reports.functions";
import { listZoneOptions } from "@/lib/bookings.functions";
import { getWeeklyExpertReport } from "@/lib/experts.functions";
import { BatchDetail } from "@/components/wallets-page";
import type { PayoutBatch } from "@/lib/wallets.functions";
import { buildCaExportZip, downloadBlob, fetchPnlExtras } from "@/lib/ca-export";
import { fetchPartnerFees } from "@/components/partner-payments";

type StaffRole = "super_admin" | "ops_manager" | "area_partner" | "finance";

const TABS = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "services", label: "Service-wise" },
  { key: "maids", label: "Maid hours & pay" },
  { key: "revenue", label: "Revenue" },
  { key: "bookings", label: "Bookings" },
  { key: "experts", label: "Experts (Services)" },
  { key: "riders", label: "Riders (Delivery)" },
  { key: "stores", label: "Store-wise" },
  { key: "referrals", label: "Referrals" },
  { key: "payouts", label: "Payouts" },
  { key: "customers", label: "Customers" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const PIE_COLORS = [
  "#00B97A",
  "#2563EB",
  "#F59E0B",
  "#DC2626",
  "#6B7280",
  "#16A34A",
  "#7C3AED",
];

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 29 * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

function fmtShortDate(d: string) {
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function ReportsPage({ role }: { role: StaffRole | null }) {
  const [tab, setTab] = useState<TabKey>("pnl");
  const init = useMemo(defaultRange, []);
  const [from, setFrom] = useState<string>(init.from);
  const [to, setTo] = useState<string>(init.to);
  const [zoneId, setZoneId] = useState<string>("");

  const fetchZones = useServerFn(listZoneOptions);
  const { data: zones = [] } = useQuery({
    queryKey: ["reports", "zone-options"],
    queryFn: () => fetchZones(),
    staleTime: 60_000,
  });

  const range: ReportRange = {
    from,
    to,
    zoneId: zoneId || null,
  };

  const visibleTabs = TABS.filter((t) => {
    if (role !== "area_partner") return true;
    // area_partner sees only reports meaningful in their zone scope
    return !["referrals", "payouts", "riders", "stores"].includes(t.key);
  });

  return (
    <div className="space-y-6">
      {(role === "super_admin" || role === "ops_manager") && (
        <>
          {/* Non-money live counters moved to the Dashboard */}
          <DailyOrdersChart />
        </>
      )}
      {/* Filters */}
      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Report</label>
          <select value={tab} onChange={(e) => setTab(e.target.value as typeof tab)} className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[180px]">
            {visibleTabs.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
            From
          </label>
          <DateInput
            
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
            To
          </label>
          <DateInput
            
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
          />
        </div>
        {role !== "area_partner" && (
          <div className="min-w-[200px]">
            <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
              Zone
            </label>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] w-full"
            >
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>


      {tab === "pnl" && <PnlTab range={range} />}
      {tab === "services" && <ServiceWiseTab range={range} />}
      {tab === "maids" && <MaidWorkTab range={range} />}
      {tab === "revenue" && <RevenueTab range={range} />}
      {tab === "bookings" && <BookingsTab range={range} />}
      {tab === "experts" && <ExpertsTab range={range} />}
      {tab === "riders" && role !== "area_partner" && <RidersTab range={range} />}
      {tab === "stores" && role !== "area_partner" && <StoresTab range={range} />}
      {tab === "referrals" && role !== "area_partner" && <ReferralsTab range={range} />}
      {tab === "payouts" && role !== "area_partner" && <PayoutsTab range={range} />}
      {tab === "customers" && <CustomersTab range={range} />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-[18px] p-5">{children}</div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-card border border-border rounded-[18px] p-5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-[24px] font-bold text-foreground">{value}</p>
    </div>
  );
}

function Loading() {
  return (
    <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
  );
}
function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p className="text-[13px] text-red-600 text-center py-10">Failed to load: {msg}</p>
  );
}

// ============ Revenue ============
function RevenueTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getRevenueReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "revenue", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const { data: ex } = useQuery({
    queryKey: ["reports", "pnl-extras", range.from, range.to],
    queryFn: () => fetchPnlExtras(range.from, range.to),
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const caExport = async () => {
    setZipBusy(true); setZipErr(null);
    try { downloadBlob(await buildCaExportZip(range.from, range.to), `badiyos-ca-export-${range.from}-to-${range.to}.zip`); }
    catch (e) { setZipErr((e as Error).message); }
    finally { setZipBusy(false); }
  };
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Total Revenue" value={inr.format(data.summary.totalRevenue)} />
        <Stat label="Avg Daily Revenue" value={inr.format(data.summary.avgDaily)} />
        <Stat label="Paid Bookings" value={data.summary.paidBookings} />
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">Revenue trend</h3>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="date" tickFormatter={fmtShortDate} fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip
                formatter={(v: number) => inr.format(v)}
                labelFormatter={fmtShortDate}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#00B97A"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">
          Revenue by category
        </h3>
        {data.byCategory.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No paid bookings in this range.</p>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_140px] gap-4 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Category</span>
              <span>Segment</span>
              <span className="text-right">Bookings</span>
              <span className="text-right">Revenue</span>
            </div>
            {data.byCategory.map((c) => (
              <div
                key={c.categoryId ?? "none"}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_140px] gap-4 py-2.5 text-[13px]"
              >
                <span className="font-semibold text-foreground truncate">{c.categoryName}</span>
                <span className="text-muted-foreground truncate">{c.segmentName}</span>
                <span className="text-right text-muted-foreground">{c.bookings}</span>
                <span className="text-right font-bold text-foreground">
                  {inr.format(c.revenue)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );

}

// ============ Bookings ============
function BookingsTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getBookingsReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "bookings", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const { data: ex } = useQuery({
    queryKey: ["reports", "pnl-extras", range.from, range.to],
    queryFn: () => fetchPnlExtras(range.from, range.to),
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const caExport = async () => {
    setZipBusy(true); setZipErr(null);
    try { downloadBlob(await buildCaExportZip(range.from, range.to), `badiyos-ca-export-${range.from}-to-${range.to}.zip`); }
    catch (e) { setZipErr((e as Error).message); }
    finally { setZipBusy(false); }
  };
  const [drill, setDrill] = useState<Drill | null>(null);
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-[15px] font-bold text-foreground mb-4">
            Bookings by status ({data.total} total)
          </h3>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="status" fontSize={11} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#00B97A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h3 className="text-[15px] font-bold text-foreground mb-4">
            Cancellation reasons
          </h3>
          {data.cancellationReasons.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-8 text-center">
              No cancellations or rejections in range.
            </p>
          ) : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.cancellationReasons}
                    dataKey="count"
                    nameKey="reason"
                    outerRadius={90}
                    label
                  >
                    {data.cancellationReasons.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">Bookings by zone</h3>
        {data.byZone.length === 0 ? (
          <p className="text-[13px] text-muted-foreground text-center py-10">No bookings in range.</p>
        ) : (
          <div className="border border-border rounded-[14px] overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-3">Zone</th>
                  <th className="text-right px-3 py-3">Completed</th>
                  <th className="text-right px-3 py-3">Cancelled</th>
                  <th className="text-right px-3 py-3">Other</th>
                  <th className="text-right px-3 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.byZone.map((z) => {
                  const zid = z.zoneId ?? "none";
                  const cell = (n: number, label: string, status?: string) => (
                    <td className="text-right px-3 py-3">
                      {n > 0 ? (
                        <button
                          className="text-primary underline font-semibold"
                          onClick={() => setDrill({ title: `${z.zoneName} — ${n} ${label}`, zoneId: zid, status })}
                        >
                          {n}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  );
                  return (
                    <tr key={zid} className="border-t border-border">
                      <td className="px-3 py-3 text-foreground">{z.zoneName}</td>
                      {cell(z.completed, "completed", "completed")}
                      {cell(z.cancelled, "cancelled", "__cancelled")}
                      {cell(z.other, "other (pending/ongoing)", "__other")}
                      {cell(z.count, "bookings")}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">Bookings by status</h3>
        <SimpleTable
          columns={["Status", "Count"]}
          rows={data.byStatus.map((s) => [s.status, String(s.count)])}
          emptyText="No bookings in range."
          onRowClick={(i) => {
            const s = data.byStatus[i];
            setDrill({ title: `${s.status} — ${s.count} bookings`, status: s.status });
          }}
        />
      </Card>
      {drill && <BookingDrilldown range={range} drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

type Drill = { title: string; zoneId?: string; status?: string };
function BookingDrilldown({ range, drill, onClose }: { range: ReportRange; drill: Drill; onClose: () => void }) {
  const fetchFn = useServerFn(getBookingsDrilldown);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "bookings-drill", range, drill],
    queryFn: () => fetchFn({ data: { ...range, zoneId: drill.zoneId ?? range.zoneId ?? null, status: drill.status ?? null } }),
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-bold text-foreground">{drill.title}</h3>
          <button onClick={onClose} className="h-8 px-3 rounded-[10px] bg-muted text-[12px] font-semibold">Close</button>
        </div>
        {isLoading ? <Loading /> : error ? <ErrorMsg msg={(error as Error).message} /> : (
          <SimpleTable
            columns={["Booking", "Date", "Service", "Customer", "Expert", "Status", "Amount"]}
            rows={(data ?? []).map((r) => [r.number, r.date, r.service, r.customer, r.expert, r.status, inr.format(r.amount)])}
            rightAlign={[6]}
            emptyText="No bookings."
          />
        )}
      </div>
    </div>
  );
}

type EntityDrill = { kind: "expert" | "rider" | "store"; id: string; title: string };
function EntityDrilldown({ range, drill, onClose }: { range: ReportRange; drill: EntityDrill; onClose: () => void }) {
  const fetchFn = useServerFn(getEntityDrilldown);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "entity-drill", range, drill.kind, drill.id],
    queryFn: () => fetchFn({ data: { ...range, kind: drill.kind, id: drill.id } }),
  });
  const amountLabel = drill.kind === "expert" ? "Expert pay" : "Amount";
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-[16px] font-bold text-foreground">{drill.title}</h3>
          <button onClick={onClose} className="h-8 px-3 rounded-[10px] bg-muted text-[12px] font-semibold">Close</button>
        </div>
        {isLoading ? <Loading /> : error ? <ErrorMsg msg={(error as Error).message} /> : (
          <SimpleTable
            columns={["Order", "Date", "Status", amountLabel]}
            rows={(data ?? []).map((r) => [r.number, r.date, r.status, inr.format(r.amount)])}
            rightAlign={[3]}
            emptyText="No orders."
          />
        )}
      </div>
    </div>
  );
}

// ============ Experts ============
function lastWeekIst() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  const today = f.format(new Date());
  const t = new Date(`${today}T12:00:00+05:30`);
  const dow = (t.getUTCDay() + 6) % 7;
  const mon = new Date(t.getTime() - (dow + 7) * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  return { from: f.format(mon), to: f.format(sun) };
}
function WeeklyPdfButton() {
  const fetchFn = useServerFn(getWeeklyExpertReport);
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { from, to } = lastWeekIst();
          const res = await fetchFn({ data: { from, to } });
          const { downloadWeeklyExpertPdf } = await import("@/lib/weekly-expert-pdf");
          await downloadWeeklyExpertPdf(from, to, res.rows, res.batchStatus);
        } catch (e) {
          window.alert(e instanceof Error ? e.message : "Download failed");
        } finally {
          setBusy(false);
        }
      }}
      className="h-8 px-3 rounded-[10px] text-[12px] font-bold bg-primary text-primary-foreground disabled:opacity-50"
    >
      {busy ? "Preparing…" : "Download last week PDF"}
    </button>
  );
}
function ExpertsTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getExpertPerformance);
  const [sort, setSort] = useState<"completed" | "earnings">("completed");
  const [ed, setEd] = useState<EntityDrill | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "experts", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const { data: ex } = useQuery({
    queryKey: ["reports", "pnl-extras", range.from, range.to],
    queryFn: () => fetchPnlExtras(range.from, range.to),
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const caExport = async () => {
    setZipBusy(true); setZipErr(null);
    try { downloadBlob(await buildCaExportZip(range.from, range.to), `badiyos-ca-export-${range.from}-to-${range.to}.zip`); }
    catch (e) { setZipErr((e as Error).message); }
    finally { setZipBusy(false); }
  };
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  const rows = [...(data ?? [])].sort((a, b) =>
    sort === "completed" ? b.completed - a.completed : b.earnings - a.earnings,
  );

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-[15px] font-bold text-foreground">Expert performance</h3>
        <div className="flex gap-1 flex-wrap">
          <WeeklyPdfButton />
          {(["completed", "earnings"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`h-8 px-3 rounded-[10px] text-[12px] font-semibold ${
                sort === k
                  ? "bg-primary-tint text-primary"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              Sort by {k === "completed" ? "bookings" : "earnings"}
            </button>
          ))}
        </div>
      </div>
      <SimpleTable
        columns={["Expert", "Zone", "Level", "Completed", "Earnings"]}
        rows={rows.map((r) => [
          r.name,
          r.zoneName,
          r.level ?? "—",
          String(r.completed),
          inr.format(r.earnings),
        ])}
        rightAlign={[3, 4]}
        emptyText="No experts to show."
        onRowClick={(i) => setEd({ kind: "expert", id: rows[i].expertId, title: `${rows[i].name} — ${rows[i].completed} completed bookings` })}
      />
      {ed && <EntityDrilldown range={range} drill={ed} onClose={() => setEd(null)} />}
    </Card>
  );
}


// ============ Referrals ============
function ReferralsTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getReferralReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "referrals", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const { data: ex } = useQuery({
    queryKey: ["reports", "pnl-extras", range.from, range.to],
    queryFn: () => fetchPnlExtras(range.from, range.to),
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const caExport = async () => {
    setZipBusy(true); setZipErr(null);
    try { downloadBlob(await buildCaExportZip(range.from, range.to), `badiyos-ca-export-${range.from}-to-${range.to}.zip`); }
    catch (e) { setZipErr((e as Error).message); }
    finally { setZipBusy(false); }
  };
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Total Referrals" value={data.summary.total} />
        <Stat label="Successful Referrals" value={data.summary.successful} />
        <Stat label="Coins Paid Out" value={data.summary.coinsPaid} />
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">
          Successful referrals trend
        </h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="date" tickFormatter={fmtShortDate} fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip labelFormatter={fmtShortDate} />
              <Line
                type="monotone"
                dataKey="successful"
                stroke="#2563EB"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ============ Payouts ============
function PayoutsTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getPayoutOverview);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "payouts-all", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const [openBatch, setOpenBatch] = useState<PayoutBatch | null>(null);
  if (openBatch) return <BatchDetail batch={openBatch} onBack={() => setOpenBatch(null)} />;
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  const rows = data ?? [];
  const groups = ["Experts & Riders", "Stores", "Area Partners"] as const;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {groups.map((g) => {
          const gr = rows.filter((r) => r.group === g);
          const paid = gr.filter((r) => r.status === "paid").reduce((x, r) => x + r.net, 0);
          const pending = gr.filter((r) => r.status !== "paid").reduce((x, r) => x + r.net, 0);
          return (
            <div key={g} className="bg-card border border-border rounded-[18px] p-5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{g}</p>
              <p className="mt-2 text-[20px] font-bold text-foreground">{inr.format(paid)} paid</p>
              <p className="text-[13px] text-muted-foreground">{inr.format(pending)} pending · {gr.length} batches</p>
            </div>
          );
        })}
      </div>
      {groups.map((g) => {
        const gr = rows.filter((r) => r.group === g);
        return (
          <Card key={g}>
            <h3 className="text-[15px] font-bold text-foreground mb-1">{g} payout batches</h3>
            {g === "Experts & Riders" && (
              <p className="text-[12px] text-muted-foreground mb-3">Riders are paid from the same wallet batch; see Riders tab for their delivery earnings.</p>
            )}
            {g === "Area Partners" && (
              <p className="text-[12px] text-muted-foreground mb-3">Open Partner Program → Payouts to edit, approve or mark paid.</p>
            )}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <SimpleTable
                  columns={["Period", "Status", "Gross", "TDS", "Net", ""]}
                  rightAlign={[2, 3, 4]}
                  emptyText="No batches in range."
                  onRowClick={g === "Area Partners" ? undefined : (i) => { const r = gr[i]; setOpenBatch({ id: r.id, week_start: r.from, week_end: r.to, status: r.status as "pending" | "paid", total_amount: r.net, created_at: r.from, batch_type: r.batchType ?? "expert" }); }}
                  rows={gr.map((r) => [
                    `${fmtShortDate(r.from)} – ${fmtShortDate(r.to)}`,
                    r.status.toUpperCase(),
                    inr.format(r.gross),
                    inr.format(r.tds),
                    inr.format(r.net),
                    "",
                  ])}
                />
              </div>
            </div>
            {g !== "Area Partners" && gr.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {gr.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setOpenBatch({ id: r.id, week_start: r.from, week_end: r.to, status: r.status as "pending" | "paid", total_amount: r.net, created_at: r.from, batch_type: r.batchType ?? "expert" })}
                    className="h-8 px-3 rounded-[10px] border border-border font-semibold text-[12px] hover:bg-muted"
                  >
                    View {fmtShortDate(r.from)}
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ============ Riders ============
function RidersTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getRiderReport);
  const [ed, setEd] = useState<EntityDrill | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["reports", "riders", range], queryFn: () => fetchFn({ data: range }) });
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {data.byKind.map((k) => (
          <div key={k.kind} className="bg-card border border-border rounded-[18px] p-5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{k.kind}</p>
            <p className="mt-2 text-[20px] font-bold text-foreground">{k.orders} delivered</p>
            <p className="text-[13px] text-muted-foreground">Rider pay {inr.format(k.riderPayout)} · Our earning {inr.format(k.platformEarning)}</p>
          </div>
        ))}
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-1">Rider performance</h3>
        <p className="text-[12px] text-muted-foreground mb-3">Delivered paid orders only. Rider pay = amount excl. GST × rider share.</p>
        <div className="overflow-x-auto"><div className="min-w-[760px]">
          <SimpleTable
            columns={["Rider", "Total", "Delivery", "Store", "Bulk", "Collected", "Rider pay", "Our earning"]}
            rightAlign={[1, 2, 3, 4, 5, 6, 7]}
            emptyText="No delivered orders in range."
            rows={data.rows.map((r) => [r.name, String(r.orders), String(r.delivery), String(r.store), String(r.bulk), inr.format(r.collected), inr.format(r.riderPayout), inr.format(r.platformEarning)])}
            onRowClick={(i) => setEd({ kind: "rider", id: data.rows[i].riderId, title: `${data.rows[i].name} — ${data.rows[i].orders} deliveries` })}
          />
        </div></div>
      </Card>
      {ed && <EntityDrilldown range={range} drill={ed} onClose={() => setEd(null)} />}
    </div>
  );
}

// ============ Store-wise ============
function StoresTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getStoreReport);
  const [ed, setEd] = useState<EntityDrill | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["reports", "stores", range], queryFn: () => fetchFn({ data: range }) });
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  const rows = data ?? [];
  const sum = (k: "sales" | "commission" | "commissionGst" | "merchantPayout" | "orders") => rows.reduce((x, r) => x + r[k], 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Store Sales" value={inr.format(sum("sales"))} />
        <Stat label="Our Commission" value={inr.format(sum("commission"))} />
        <Stat label="GST on Commission" value={inr.format(sum("commissionGst"))} />
        <Stat label="Payable to Stores" value={inr.format(sum("merchantPayout"))} />
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-1">Commission by store</h3>
        <p className="text-[12px] text-muted-foreground mb-3">Completed, non-training store orders. Store delivery fees are in the Riders tab.</p>
        <div className="overflow-x-auto"><div className="min-w-[760px]">
          <SimpleTable
            columns={["Store", "Orders", "Sales", "Refunds", "Commission", "Comm. %", "GST", "Store payout"]}
            rightAlign={[1, 2, 3, 4, 5, 6, 7]}
            emptyText="No completed store orders in range."
            rows={rows.map((r) => [r.storeName, String(r.orders), inr.format(r.sales), inr.format(r.refunds), inr.format(r.commission), `${r.commissionPct.toFixed(1)}%`, inr.format(r.commissionGst), inr.format(r.merchantPayout)])}
            onRowClick={(i) => setEd({ kind: "store", id: rows[i].merchantId, title: `${rows[i].storeName} — ${rows[i].orders} orders` })}
          />
        </div></div>
      </Card>
      {ed && <EntityDrilldown range={range} drill={ed} onClose={() => setEd(null)} />}
    </div>
  );
}

// ============ Customers ============
function CustomersTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getCustomerReport);
  const [drill, setDrill] = useState<Drill | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "customers", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const { data: ex } = useQuery({
    queryKey: ["reports", "pnl-extras", range.from, range.to],
    queryFn: () => fetchPnlExtras(range.from, range.to),
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const caExport = async () => {
    setZipBusy(true); setZipErr(null);
    try { downloadBlob(await buildCaExportZip(range.from, range.to), `badiyos-ca-export-${range.from}-to-${range.to}.zip`); }
    catch (e) { setZipErr((e as Error).message); }
    finally { setZipBusy(false); }
  };
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Stat label="New Customers" value={data.newCustomers} />
        <Stat label="Repeat Customers" value={data.repeatCustomers} />
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">
          Top 5 zones by customer count
        </h3>
        <SimpleTable
          columns={["Zone", "Customers"]}
          rows={data.topZones.map((z) => [z.zoneName, String(z.customers)])}
          rightAlign={[1]}
          emptyText="No customers in range."
          onRowClick={(i) => { const z = data.topZones[i]; setDrill({ title: `${z.zoneName} — bookings`, zoneId: z.zoneId ?? "none" }); }}
        />
      </Card>
      {drill && <BookingDrilldown range={range} drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

// ============ Table helper ============
function SimpleTable({
  columns,
  rows,
  emptyText,
  rightAlign = [],
  onRowClick,
}: {
  columns: string[];
  rows: string[][];
  emptyText: string;
  rightAlign?: number[];
  onRowClick?: (index: number) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground text-center py-10">{emptyText}</p>
    );
  }
  return (
    <div className="border border-border rounded-[14px] overflow-hidden">
      <div
        className="grid gap-4 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((c, i) => (
          <span key={c} className={rightAlign.includes(i) ? "text-right" : ""}>
            {c}
          </span>
        ))}
      </div>
      {rows.map((r, ri) => (
        <div
          key={ri}
          onClick={onRowClick ? () => onRowClick(ri) : undefined}
          className={`grid gap-4 items-center px-5 py-3 border-b border-border last:border-b-0 text-[13px] ${onRowClick ? "cursor-pointer hover:bg-muted/50" : ""}`}
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {r.map((cell, ci) => (
            <span
              key={ci}
              className={`truncate ${
                rightAlign.includes(ci) ? "text-right font-semibold" : "text-foreground"
              } ${onRowClick && ci === r.length - 1 ? "text-primary underline" : ""}`}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============ Profit & Loss ============
function Row({ label, value, sub, bold, neg }: { label: string; value: number; sub?: string; bold?: boolean; neg?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 text-[14px] ${bold ? "border-t border-border font-bold" : ""}`}>
      <span className={bold ? "text-foreground" : "text-muted-foreground"}>
        {label}
        {sub && <span className="block text-[11px] text-muted-foreground font-normal">{sub}</span>}
      </span>
      <span className={neg ? "text-destructive" : "text-foreground"}>
        {neg && value > 0 ? "− " : ""}
        {inr.format(Math.abs(value))}
      </span>
    </div>
  );
}

function PnlTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getPnlReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "pnl", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const { data: ex } = useQuery({
    queryKey: ["reports", "pnl-extras", range.from, range.to],
    queryFn: () => fetchPnlExtras(range.from, range.to),
  });
  const { data: pf } = useQuery({
    queryKey: ["fin-partner-fees", range.from, range.to],
    queryFn: () => fetchPartnerFees(range.from, range.to),
  });
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const caExport = async () => {
    setZipBusy(true); setZipErr(null);
    try { downloadBlob(await buildCaExportZip(range.from, range.to), `badiyos-ca-export-${range.from}-to-${range.to}.zip`); }
    catch (e) { setZipErr((e as Error).message); }
    finally { setZipBusy(false); }
  };
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;
  const T = data.totals;
  const s = data.services, c = data.courier, m = data.store;
  const P = (() => {
    const revenue = T.collected - T.gst;
    const direct = m.merchantPayout + s.expertPayout + s.partnerPayout + c.riderPayout + data.programCommission + T.bonuses + T.refunds + data.gatewayCharges.total;
    const gross = revenue - direct;
    const instant = Number(ex?.instant_fee ?? 0);
    const franchise = Number(pf?.fee_income ?? 0);
    const expenses = Number(ex?.expenses_total ?? 0);
    const recovered = data.adjustments?.recoveryTotal ?? 0;
    return { revenue, direct, gross, instant, franchise, expenses, recovered, net: gross + instant + franchise - expenses + recovered };
  })();

  const exportCsv = () => {
    const lines: Array<[string, number]> = [
      ["Revenue (excl GST)", P.revenue],
      ["Direct cost – Merchant payouts", m.merchantPayout], ["Direct cost – Expert payouts", s.expertPayout + s.partnerPayout],
      ["Direct cost – Rider payouts", c.riderPayout], ["Direct cost – Partner Program commission", data.programCommission],
      ["Direct cost – Bonuses", T.bonuses], ["Direct cost – Refunds", T.refunds], ["Direct cost – Razorpay fees", data.gatewayCharges.total],
      ["Gross profit", P.gross],
      ["Other Income – Instant Settlement Fee", P.instant], ["Other Income – Franchise Fee", P.franchise],
      ...((ex?.expenses_by_category ?? []).map((e) => [`Expense – ${e.category}`, Number(e.amount)] as [string, number])),
      ...((data.adjustments?.recoveries ?? []).map((r) => [`Recovered from experts – ${r.category}`, r.amount] as [string, number])),
      [P.net < 0 ? "Net loss (Debit)" : "Net profit", P.net],
      ["GST collected on customer orders", T.gst], ["GST on instant fee", Number(ex?.instant_fee_gst ?? 0)], ["GST on franchise fees", Number(pf?.fee_gst ?? 0)], ["Partner deposits held (liability)", Number(pf?.deposits_held ?? 0)], ["GST paid on expenses", Number(ex?.expense_gst ?? 0)],
      ["Payouts paid (net)", data.paidOut.paid], ["Payouts pending (net)", data.paidOut.pending], ["TDS deducted", data.paidOut.tds],
    ];
    const csv = ["Item,Amount", ...lines.map(([k, v]) => `"${k}",${v.toFixed(2)}`), "", "Date,Collected,Payouts,Profit",
      ...data.daily.map((d) => `${d.date},${d.collected.toFixed(2)},${d.payouts.toFixed(2)},${d.profit.toFixed(2)}`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `pnl-${range.from}-to-${range.to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2 items-center">
        {zipErr && <span className="text-[12px] text-destructive">{zipErr}</span>}
        <button onClick={caExport} disabled={zipBusy} className="h-9 px-4 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted disabled:opacity-60">
          {zipBusy ? "Preparing…" : "Monthly CA export (ZIP)"}
        </button>
        <button onClick={exportCsv} className="h-9 px-4 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted">
          Download CSV
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Gross Order Value" value={inr.format(T.gross)} />
        <Stat label="Discount Given" value={inr.format(T.discount)} />
        <Stat label="Net Revenue (excl GST)" value={inr.format(T.netRevenue)} />
        <Stat label="Paid to Experts / Riders / Partners" value={inr.format(T.partnerPayouts)} />
        <Stat label="Bonuses" value={inr.format(T.bonuses)} />
        <Stat label="GST Collected" value={inr.format(T.gst)} />
        <Stat label="Refunds" value={inr.format(T.refunds)} />
        <Stat label="Gross Profit" value={inr.format(P.gross)} />
        {P.net < 0 ? (
          <div className="bg-destructive/10 border border-destructive/40 rounded-[18px] p-5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-destructive">Net Loss (Debit)</p>
            <p className="mt-2 text-[24px] font-bold text-destructive">− {inr.format(Math.abs(P.net))} Dr</p>
          </div>
        ) : (
          <Stat label="Net Profit" value={inr.format(P.net)} />
        )}
        <Stat label="Store Commission" value={inr.format(m.commission)} />
        <Stat label="Area Partner Commission" value={inr.format(data.programCommission)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-[15px] font-bold text-foreground mb-2">Overall P&amp;L</h3>
          <Row label="Revenue (excl GST)" sub={`Collected ${inr.format(T.collected)} − GST ${inr.format(T.gst)} · after discounts ${inr.format(T.discount)}`} value={P.revenue} bold />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-3">Direct costs</p>
          <Row label="Merchant payouts (Store & Food)" value={m.merchantPayout} neg />
          <Row label="Expert payouts (services)" value={s.expertPayout + s.partnerPayout} neg />
          <Row label="Rider payouts (delivery, store & bulk)" value={c.riderPayout} neg />
          <Row label="Partner Program commission" value={data.programCommission} neg />
          <Row label="Bonuses / incentives" value={T.bonuses} neg />
          <Row label="Refunds" value={T.refunds} neg />
          <Row label="Razorpay fees" sub={`Fees ${inr.format(data.gatewayCharges.fees)} + GST ${inr.format(data.gatewayCharges.gst)}`} value={data.gatewayCharges.total} neg />
          <Row label={`Gross profit · ${P.revenue > 0 ? ((P.gross / P.revenue) * 100).toFixed(1) : "0.0"}%`} value={P.gross} bold />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-3">Other income</p>
          <Row label="Other Income – Instant Settlement Fee" sub="Excl GST" value={P.instant} />
          <Row label="Other Income – Franchise Fee" sub="Partner franchise / joining / renewal / other fees, excl GST" value={P.franchise} />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-3">Expenses</p>
          {(ex?.expenses_by_category ?? []).length === 0 && <p className="text-[12px] text-muted-foreground py-2">No expenses in range.</p>}
          {(ex?.expenses_by_category ?? []).map((e) => (
            <Row key={e.category} label={e.category} value={Number(e.amount)} neg />
          ))}
          {(data.adjustments?.recoveries ?? []).map((r) => (
            <Row key={`rec-${r.category}`} label={`Recovered from experts – ${r.category}`} sub="Manual wallet debits marked as expense recovery" value={r.amount} />
          ))}
          {P.net < 0 ? (
            <div className="mt-2 flex items-center justify-between rounded-[12px] border border-destructive/40 bg-destructive/10 px-3 py-3 text-[15px] font-bold text-destructive">
              <span className="flex items-center gap-2">
                Net loss (Debit) · {P.revenue > 0 ? ((P.net / P.revenue) * 100).toFixed(1) : "0.0"}%
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive-foreground">Loss</span>
              </span>
              <span>− {inr.format(Math.abs(P.net))} Dr</span>
            </div>
          ) : (
            <Row label={`Net profit · ${P.revenue > 0 ? ((P.net / P.revenue) * 100).toFixed(1) : "0.0"}%`} value={P.net} bold />
          )}
        </Card>
        {ex && (
          <Card>
            <h3 className="text-[15px] font-bold text-foreground mb-2">GST (shown separately, not income)</h3>
            <Row label="GST collected on customer orders" value={T.gst} />
            <Row label="GST on store commission" value={m.commissionGst} />
            <Row label="GST on instant settlement fee" value={Number(ex.instant_fee_gst)} />
            <Row label="GST on franchise fees" value={Number(pf?.fee_gst ?? 0)} />
            <Row label="GST paid on expenses (input credit)" value={Number(ex.expense_gst)} neg />
          </Card>
        )}
        <Card>
          <h3 className="text-[15px] font-bold text-foreground mb-2">Payout status (batches in range)</h3>
          <Row label="Paid out (after TDS)" value={data.paidOut.paid} />
          <Row label="Pending to pay" value={data.paidOut.pending} />
          <Row label="TDS deducted" value={data.paidOut.tds} />
          <p className="text-[12px] text-muted-foreground mt-3">
            Expert/partner amounts count only completed orders; rider amounts only delivered parcels. Training and test orders are excluded.
          </p>
        </Card>
      </div>

      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">By business line</h3>
        <SimpleTable
          columns={["Line", "Orders", "Gross", "Discount", "Net revenue", "Paid to partners", "Platform earning"]}
          rightAlign={[1, 2, 3, 4, 5, 6]}
          emptyText="No orders in range."
          rows={[
            ["Services", String(s.orders), inr.format(s.gross), inr.format(s.discount + s.coinDiscount), inr.format(s.netRevenue), inr.format(s.expertPayout + s.partnerPayout), inr.format(s.platformEarning)],
            ["Delivery (all rider work)", String(c.orders), inr.format(c.gross), inr.format(c.discount + c.coinDiscount), inr.format(c.netRevenue), inr.format(c.riderPayout), inr.format(c.platformEarning)],
            ["Store items", String(m.orders), inr.format(m.gross), inr.format(0), inr.format(m.commission), inr.format(m.merchantPayout), inr.format(m.commission)],
          ]}
        />
      </Card>

      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">Collected vs payouts vs profit</h3>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="date" tickFormatter={fmtShortDate} fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v: number) => inr.format(v)} labelFormatter={fmtShortDate} />
              <Legend />
              <Line type="monotone" dataKey="collected" name="Collected" stroke="#2563EB" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="payouts" name="Payouts" stroke="#F59E0B" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profit" name="Profit" stroke="#00B97A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

// ============ Service-wise ============
function ServiceWiseTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getServiceReport);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "service-wise", range],
    queryFn: () => fetchFn({ data: range }),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;
  const tot = data.reduce((a, r) => ({ orders: a.orders + r.orders, gross: a.gross + r.gross, discount: a.discount + r.discount, refunds: a.refunds + r.refunds, gst: a.gst + r.gst, net: a.net + r.net }), { orders: 0, gross: 0, discount: 0, refunds: 0, gst: 0, net: 0 });
  const all = [...data.map((r) => [r.service, r]), ["Total", tot]] as Array<[string, typeof tot]>;
  const exportCsv = () => {
    const csv = ["Service,Successful orders,Gross revenue,Discount,Refunds,GST,Net revenue (excl GST)",
      ...all.map(([n, r]) => `"${n}",${r.orders},${r.gross.toFixed(2)},${r.discount.toFixed(2)},${r.refunds.toFixed(2)},${r.gst.toFixed(2)},${r.net.toFixed(2)}`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `service-wise-${range.from}-to-${range.to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Successful orders" value={tot.orders} />
        <Stat label="Gross revenue" value={inr.format(tot.gross)} />
        <Stat label="Net revenue (excl GST)" value={inr.format(tot.net)} />
      </div>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-bold text-foreground">Service-wise</h3>
          <button onClick={exportCsv} className="h-9 px-4 rounded-[12px] border border-border font-semibold text-[13px] hover:bg-muted">Download CSV</button>
        </div>
        <SimpleTable
          columns={["Service", "Successful orders", "Gross revenue", "Discount", "Refunds", "GST", "Net revenue"]}
          rightAlign={[1, 2, 3, 4, 5, 6]}
          emptyText="No orders."
          rows={all.map(([n, r], i) => [`${data[i]?.sub?.length ? (open === data[i].key ? "▾ " : "▸ ") : ""}${n}`, String(r.orders), inr.format(r.gross), inr.format(r.discount), inr.format(r.refunds), inr.format(r.gst), inr.format(r.net)])}
          onRowClick={(i) => { const k = data[i]?.key; if (k && data[i].sub?.length) setOpen(open === k ? null : k); }}
        />
        {open && (() => {
          const p = data.find((d) => d.key === open);
          if (!p?.sub?.length) return null;
          return (
            <div className="mt-4">
              <h4 className="text-[13px] font-bold text-foreground mb-2">{p.service} — breakup by service</h4>
              <SimpleTable
                columns={["Service", "Successful orders", "Gross revenue", "Discount", "Refunds", "GST", "Net revenue"]}
                rightAlign={[1, 2, 3, 4, 5, 6]}
                emptyText="No orders."
                rows={p.sub.map((r) => [r.service, String(r.orders), inr.format(r.gross), inr.format(r.discount), inr.format(r.refunds), inr.format(r.gst), inr.format(r.net)])}
              />
            </div>
          );
        })()}
        <p className="text-[12px] text-muted-foreground mt-3">
          Successful = completed bookings / delivered orders. Gross = order value before discount, incl. GST. Net = gross − discount − refunds − GST. Training, test and bulk delivery orders are excluded.
        </p>
      </Card>
    </div>
  );
}

// ============ Maid hours & pay (Clean Home) ============
function MaidWorkTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getMaidWorkReport);
  const { data, isLoading, error } = useQuery({ queryKey: ["reports", "maids", range], queryFn: () => fetchFn({ data: range }) });
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;
  const h = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Hours worked" value={h(data.hours)} />
        <Stat label="Orders" value={data.orders} />
        <Stat label="Maids" value={data.maids} />
        <Stat label="Basic pay" value={inr.format(data.basicPay)} />
        <Stat label="Bonus" value={inr.format(data.bonus)} />
        <Stat label="Total paid" value={inr.format(data.totalPay)} />
        <Stat label="Avg basic / hour" value={inr.format(data.avgBasicPerHour)} />
        <Stat label="Avg total (basic + bonus) / hour" value={inr.format(data.avgTotalPerHour)} />
      </div>
      <Card>
        <h3 className="text-[15px] font-bold text-foreground mb-4">Per maid</h3>
        <SimpleTable
          columns={["Maid", "Orders", "Hours", "Basic pay", "Bonus", "Total", "Per hour"]}
          rows={data.rows.map((r) => [r.name, String(r.orders), h(r.hours), inr.format(r.basicPay), inr.format(r.bonus), inr.format(r.totalPay), inr.format(r.perHour)])}
          rightAlign={[1, 2, 3, 4, 5, 6]}
          emptyText="No completed Clean Home orders in this period."
        />
        <p className="mt-3 text-[11px] text-muted-foreground">Completed Clean Home orders only (training/test excluded). Hours include approved extensions. Basic = credited order payouts; Bonus = rewards/incentives credited in this period.</p>
      </Card>
    </div>
  );
}
