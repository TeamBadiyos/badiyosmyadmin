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
  getExpertPerformance,
  getReferralReport,
  getPayoutReport,
  getCustomerReport,
  getPnlReport,
  type ReportRange,
} from "@/lib/reports.functions";
import { listZoneOptions } from "@/lib/bookings.functions";
import { BatchDetail } from "@/components/wallets-page";
import type { PayoutBatch } from "@/lib/wallets.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const TABS = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "revenue", label: "Revenue" },
  { key: "bookings", label: "Bookings" },
  { key: "experts", label: "Experts" },
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
    return t.key !== "referrals" && t.key !== "payouts";
  });

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-card border border-border rounded-[18px] p-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
            From
          </label>
          <DateInput
            
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
            To
          </label>
          <DateInput
            
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px]"
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
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px] w-full"
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-[14px] font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pnl" && <PnlTab range={range} />}
      {tab === "revenue" && <RevenueTab range={range} />}
      {tab === "bookings" && <BookingsTab range={range} />}
      {tab === "experts" && <ExpertsTab range={range} />}
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
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_100px_140px] gap-4 py-2.5 text-[14px]"
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
        <SimpleTable
          columns={["Zone", "Count"]}
          rows={data.byZone.map((z) => [z.zoneName, String(z.count)])}
          emptyText="No bookings in range."
        />
      </Card>
    </div>
  );
}

// ============ Experts ============
function ExpertsTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getExpertPerformance);
  const [sort, setSort] = useState<"completed" | "earnings">("completed");
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "experts", range],
    queryFn: () => fetchFn({ data: range }),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  const rows = [...(data ?? [])].sort((a, b) =>
    sort === "completed" ? b.completed - a.completed : b.earnings - a.earnings,
  );

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-[15px] font-bold text-foreground">Expert performance</h3>
        <div className="flex gap-1">
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
      />
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
  const fetchFn = useServerFn(getPayoutReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "payouts", range],
    queryFn: () => fetchFn({ data: range }),
  });
  const [openBatch, setOpenBatch] = useState<PayoutBatch | null>(null);
  if (openBatch) {
    return <BatchDetail batch={openBatch} onBack={() => setOpenBatch(null)} />;
  }
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  const rows = data ?? [];
  return (
    <Card>
      <h3 className="text-[15px] font-bold text-foreground mb-4">Payout batches</h3>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground text-center py-10">
          No payout batches in range.
        </p>
      ) : (
        <div className="border border-border rounded-[14px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_140px_140px_120px] gap-4 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Week</span>
            <span className="text-right">Total</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>
          {rows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[minmax(0,1fr)_140px_140px_120px] gap-4 items-center px-5 py-3 border-b border-border last:border-b-0 text-[14px]"
            >
              <span className="font-semibold text-foreground">
                {fmtShortDate(r.weekStart)} – {fmtShortDate(r.weekEnd)}
              </span>
              <span className="text-right font-semibold">{inr.format(r.totalAmount)}</span>
              <span
                className={`inline-flex items-center justify-center h-6 px-2.5 rounded-full text-[11px] font-bold uppercase w-fit ${
                  r.status === "paid"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {r.status}
              </span>
              <div className="text-right">
                <button
                  onClick={() =>
                    setOpenBatch({
                      id: r.id,
                      week_start: r.weekStart,
                      week_end: r.weekEnd,
                      status: r.status,
                      total_amount: r.totalAmount,
                      created_at: r.weekStart,
                      batch_type: "expert",

                    })
                  }
                  className="h-8 px-3 rounded-[10px] border border-border font-semibold text-[12px] hover:bg-muted"
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ============ Customers ============
function CustomersTab({ range }: { range: ReportRange }) {
  const fetchFn = useServerFn(getCustomerReport);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", "customers", range],
    queryFn: () => fetchFn({ data: range }),
  });
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
        />
      </Card>
    </div>
  );
}

// ============ Table helper ============
function SimpleTable({
  columns,
  rows,
  emptyText,
  rightAlign = [],
}: {
  columns: string[];
  rows: string[][];
  emptyText: string;
  rightAlign?: number[];
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
          className="grid gap-4 items-center px-5 py-3 border-b border-border last:border-b-0 text-[14px]"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {r.map((cell, ci) => (
            <span
              key={ci}
              className={`truncate ${
                rightAlign.includes(ci) ? "text-right font-semibold" : "text-foreground"
              }`}
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
  if (isLoading) return <Loading />;
  if (error) return <ErrorMsg msg={(error as Error).message} />;
  if (!data) return null;
  const T = data.totals;
  const s = data.services, c = data.courier, m = data.store;

  const exportCsv = () => {
    const lines: Array<[string, number]> = [
      ["Gross order value", T.gross], ["Discounts (coupon + coins)", T.discount], ["Collected from customers", T.collected],
      ["Refunds", T.refunds], ["GST", T.gst], ["Net revenue (excl GST)", T.netRevenue],
      ["Expert payouts", s.expertPayout], ["Rider payouts", c.riderPayout], ["Partner Program commission", data.programCommission],
      ["Bonuses", T.bonuses], ["Store commission", m.commission], ["Platform profit", T.platformProfit],
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
      <div className="flex justify-end">
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
        <Stat label={`Platform Profit (${T.marginPct.toFixed(1)}%)`} value={inr.format(T.platformProfit)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-[15px] font-bold text-foreground mb-2">Overall P&amp;L</h3>
          <Row label="Gross order value" sub="Full price before any discount" value={T.gross} />
          <Row label="Discounts" sub="Coupons + coin / free orders" value={T.discount} neg />
          <Row label="Collected from customers" value={T.collected} bold />
          <Row label="Refunds" value={T.refunds} neg />
          <Row label="GST (goes to government)" value={T.gst} neg />
          <Row label="Net revenue" value={T.netRevenue} bold />
          <Row label="Expert payouts" value={s.expertPayout} neg />
          <Row label="Rider payouts" value={c.riderPayout} neg />
          <Row label="Partner Program commission" sub="Draft, approved and paid partner batches" value={data.programCommission} neg />
          <Row label="Bonuses / incentives" value={T.bonuses} neg />
          <Row label="Platform profit" value={T.platformProfit} bold />
        </Card>
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
            ["Courier", String(c.orders), inr.format(c.gross), inr.format(c.discount + c.coinDiscount), inr.format(c.netRevenue), inr.format(c.riderPayout), inr.format(c.platformEarning)],
            ["Store", String(m.orders), inr.format(m.gross), inr.format(0), inr.format(m.commission), inr.format(m.merchantPayout), inr.format(m.commission)],
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
