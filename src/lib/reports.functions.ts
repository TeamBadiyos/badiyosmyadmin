import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReportRange = {
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  zoneId?: string | null;
};

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getScope(supabase: any, userId: string) {
  const { loadStaffScope } = await import("@/lib/zone-scope");
  const scope = await loadStaffScope(supabase, userId);
  return {
    role: scope.role as StaffRole,
    zone_id: scope.zoneId,
    zone_ids: scope.zoneIds,
  };
}

function validateRange(input: ReportRange | undefined): ReportRange {
  const d = input ?? ({} as ReportRange);
  const today = new Date();
  const to = d.to || today.toISOString().slice(0, 10);
  const fromDefault = new Date(today.getTime() - 29 * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  const from = d.from || fromDefault;
  return { from, to, zoneId: d.zoneId ?? null };
}

function scopeZone(
  scope: { role: StaffRole; zone_ids: string[] },
  requestedZoneId: string | null | undefined,
): string[] | null | "empty" {
  if (scope.role === "area_partner") {
    if (!scope.zone_ids.length) return "empty";
    if (requestedZoneId && scope.zone_ids.includes(requestedZoneId)) return [requestedZoneId];
    return scope.zone_ids;
  }
  return requestedZoneId ? [requestedZoneId] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyZone(q: any, zoneIds: string[] | null) {
  return zoneIds && zoneIds.length ? q.in("zone_id", zoneIds) : q;
}


const rangeFrom = (from: string) => `${from}T00:00:00Z`;
const rangeTo = (to: string) => `${to}T23:59:59Z`;

// ============ Revenue ============
export type RevenueReport = {
  summary: {
    totalRevenue: number;
    paidBookings: number;
    avgDaily: number;
  };
  daily: Array<{ date: string; revenue: number; bookings: number }>;
  byCategory: Array<{
    categoryId: string | null;
    categoryName: string;
    segmentName: string;
    revenue: number;
    bookings: number;
  }>;
};

export const getRevenueReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<RevenueReport> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    if (zone === "empty")
      return {
        summary: { totalRevenue: 0, paidBookings: 0, avgDaily: 0 },
        daily: [],
        byCategory: [],
      };

    let q = context.supabase
      .from("bookings")
      .select("price, created_at, razorpay_payment_id, zone_id, service_category_id").eq("is_training", false)
      .is("deleted_at", null)
      .not("razorpay_payment_id", "is", null)
      .gte("created_at", rangeFrom(data.from))
      .lte("created_at", rangeTo(data.to));
    q = applyZone(q, zone);
    const { data: rows, error } = await q.limit(10000);
    if (error) throw new Error(error.message);

    const map = new Map<string, { revenue: number; bookings: number }>();
    // seed dates
    const start = new Date(data.from + "T00:00:00Z").getTime();
    const end = new Date(data.to + "T00:00:00Z").getTime();
    for (let t = start; t <= end; t += 86400 * 1000) {
      map.set(new Date(t).toISOString().slice(0, 10), { revenue: 0, bookings: 0 });
    }
    let total = 0;
    let count = 0;
    const catMap = new Map<string, { revenue: number; bookings: number }>();
    for (const r of (rows ?? []) as Array<{
      price: number | null;
      created_at: string;
      service_category_id: string | null;
    }>) {
      const day = r.created_at.slice(0, 10);
      const bucket = map.get(day) ?? { revenue: 0, bookings: 0 };
      const p = Number(r.price ?? 0);
      bucket.revenue += p;
      bucket.bookings += 1;
      map.set(day, bucket);
      total += p;
      count += 1;
      const key = r.service_category_id ?? "__none__";
      const cb = catMap.get(key) ?? { revenue: 0, bookings: 0 };
      cb.revenue += p;
      cb.bookings += 1;
      catMap.set(key, cb);
    }

    const catIds = Array.from(catMap.keys()).filter((k) => k !== "__none__");
    const catNames = new Map<string, { name: string; segment: string }>();
    if (catIds.length) {
      const { data: cats } = await context.supabase
        .from("service_categories")
        .select("id, name, segments(name)")
        .in("id", catIds);
      for (const c of (cats ?? []) as Array<{
        id: string;
        name: string;
        segments: { name: string } | null;
      }>) {
        catNames.set(c.id, { name: c.name, segment: c.segments?.name ?? "—" });
      }
    }

    const byCategory = Array.from(catMap.entries())
      .map(([key, v]) => ({
        categoryId: key === "__none__" ? null : key,
        categoryName: catNames.get(key)?.name ?? "Uncategorised",
        segmentName: catNames.get(key)?.segment ?? "—",
        revenue: v.revenue,
        bookings: v.bookings,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const daily = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, revenue: v.revenue, bookings: v.bookings }));
    const days = Math.max(1, daily.length);
    return {
      summary: { totalRevenue: total, paidBookings: count, avgDaily: total / days },
      daily,
      byCategory,
    };
  });


// ============ Bookings Report ============
export type BookingsReport = {
  byStatus: Array<{ status: string; count: number }>;
  byZone: Array<{ zoneId: string | null; zoneName: string; count: number }>;
  cancellationReasons: Array<{ reason: string; count: number }>;
  total: number;
};

export const getBookingsReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<BookingsReport> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    if (zone === "empty")
      return { byStatus: [], byZone: [], cancellationReasons: [], total: 0 };

    let q = context.supabase
      .from("bookings")
      .select("id, status, zone_id, cancellation_reason, created_at").eq("is_training", false)
      .is("deleted_at", null)
      .gte("created_at", rangeFrom(data.from))
      .lte("created_at", rangeTo(data.to));
    q = applyZone(q, zone);
    const { data: rows, error } = await q.limit(10000);
    if (error) throw new Error(error.message);

    const statusMap = new Map<string, number>();
    const zoneMap = new Map<string | null, number>();
    const reasonMap = new Map<string, number>();
    for (const r of (rows ?? []) as Array<{
      status: string;
      zone_id: string | null;
      cancellation_reason: string | null;
    }>) {
      statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
      zoneMap.set(r.zone_id, (zoneMap.get(r.zone_id) ?? 0) + 1);
      if (r.status === "cancelled" || r.status === "rejected") {
        const k = r.cancellation_reason ?? "UNSPECIFIED";
        reasonMap.set(k, (reasonMap.get(k) ?? 0) + 1);
      }
    }

    const zoneIds = Array.from(zoneMap.keys()).filter((z): z is string => !!z);
    let zoneNameById = new Map<string, string>();
    if (zoneIds.length) {
      const { data: zs } = await context.supabase
        .from("zones")
        .select("id, name")
        .in("id", zoneIds);
      zoneNameById = new Map(
        ((zs ?? []) as Array<{ id: string; name: string }>).map((z) => [z.id, z.name]),
      );
    }

    return {
      total: rows?.length ?? 0,
      byStatus: Array.from(statusMap.entries()).map(([status, count]) => ({ status, count })),
      byZone: Array.from(zoneMap.entries())
        .map(([zoneId, count]) => ({
          zoneId,
          zoneName: zoneId ? zoneNameById.get(zoneId) ?? "—" : "Unassigned",
          count,
        }))
        .sort((a, b) => b.count - a.count),
      cancellationReasons: Array.from(reasonMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

// ============ Expert Performance ============
export type ExpertPerformanceRow = {
  expertId: string;
  name: string;
  zoneName: string;
  level: string | null;
  completed: number;
  earnings: number;
};

export const getExpertPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<ExpertPerformanceRow[]> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    if (zone === "empty") return [];

    let q = context.supabase
      .from("bookings")
      .select("assigned_expert_id, zone_id, updated_at, status").eq("is_training", false)
      .is("deleted_at", null)
      .eq("status", "completed")
      .not("assigned_expert_id", "is", null)
      .gte("updated_at", rangeFrom(data.from))
      .lte("updated_at", rangeTo(data.to));
    q = applyZone(q, zone);
    const { data: rows, error } = await q.limit(10000);
    if (error) throw new Error(error.message);

    const completedByExpert = new Map<string, number>();
    for (const r of (rows ?? []) as Array<{ assigned_expert_id: string }>) {
      completedByExpert.set(
        r.assigned_expert_id,
        (completedByExpert.get(r.assigned_expert_id) ?? 0) + 1,
      );
    }

    // load experts (scoped by zone if applicable)
    let eq = context.supabase.from("experts").select("id, name, level, zone_id");
    if (zone) eq = eq.in("zone_id", zone);
    const { data: experts } = await eq.limit(5000);
    const expertList = (experts ?? []) as Array<{
      id: string;
      name: string;
      level: string | null;
      zone_id: string | null;
    }>;

    // zone names
    const zoneIds = Array.from(new Set(expertList.map((e) => e.zone_id).filter((z): z is string => !!z)));
    const zoneNameById = new Map<string, string>();
    if (zoneIds.length) {
      const { data: zs } = await context.supabase
        .from("zones")
        .select("id, name")
        .in("id", zoneIds);
      for (const z of (zs ?? []) as Array<{ id: string; name: string }>) {
        zoneNameById.set(z.id, z.name);
      }
    }

    // wallet ledger earnings in range
    const expertIds = expertList.map((e) => e.id);
    const earnings = new Map<string, number>();
    if (expertIds.length) {
      const { data: ledger } = await context.supabase
        .from("wallet_ledger")
        .select("owner_id, amount, type, created_at")
        .eq("owner_type", "expert")
        .in("owner_id", expertIds)
        .gte("created_at", rangeFrom(data.from))
        .lte("created_at", rangeTo(data.to))
        .limit(10000);
      for (const l of (ledger ?? []) as Array<{
        owner_id: string;
        amount: number | string;
        type: string;
      }>) {
        const delta = (l.type === "credit" ? 1 : -1) * Number(l.amount);
        earnings.set(l.owner_id, (earnings.get(l.owner_id) ?? 0) + delta);
      }
    }

    const result: ExpertPerformanceRow[] = expertList.map((e) => ({
      expertId: e.id,
      name: e.name,
      level: e.level,
      zoneName: e.zone_id ? zoneNameById.get(e.zone_id) ?? "—" : "—",
      completed: completedByExpert.get(e.id) ?? 0,
      earnings: earnings.get(e.id) ?? 0,
    }));
    result.sort((a, b) => b.completed - a.completed || b.earnings - a.earnings);
    return result;
  });

// ============ Referral Report ============
export type ReferralReport = {
  summary: { total: number; successful: number; coinsPaid: number };
  trend: Array<{ date: string; successful: number }>;
};

export const getReferralReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<ReferralReport> => {
    // area_partner does not access this section (page will hide it); still allow read
    await getScope(context.supabase, context.userId);
    const { data: txns, error } = await context.supabase
      .from("referral_transactions")
      .select("status, reward_amount, reward_date, created_at")
      .gte("created_at", rangeFrom(data.from))
      .lte("created_at", rangeTo(data.to))
      .limit(10000);
    if (error) throw new Error(error.message);

    const rows = (txns ?? []) as Array<{
      status: string;
      reward_amount: number | string | null;
      reward_date: string | null;
      created_at: string;
    }>;
    const total = rows.length;
    const successful = rows.filter((r) => r.status === "reward_credited").length;
    const coinsPaid = rows
      .filter((r) => r.status === "reward_credited")
      .reduce((s, r) => s + Number(r.reward_amount ?? 0), 0);

    const map = new Map<string, number>();
    const start = new Date(data.from + "T00:00:00Z").getTime();
    const end = new Date(data.to + "T00:00:00Z").getTime();
    for (let t = start; t <= end; t += 86400 * 1000) {
      map.set(new Date(t).toISOString().slice(0, 10), 0);
    }
    for (const r of rows) {
      if (r.status !== "reward_credited") continue;
      const d = (r.reward_date ?? r.created_at).slice(0, 10);
      if (map.has(d)) map.set(d, (map.get(d) ?? 0) + 1);
    }
    return {
      summary: { total, successful, coinsPaid },
      trend: Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, successful]) => ({ date, successful })),
    };
  });

// ============ Payout Report ============
export type PayoutReportRow = {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: "pending" | "paid";
  totalAmount: number;
};

export const getPayoutReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<PayoutReportRow[]> => {
    await getScope(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("payout_batches")
      .select("id, week_start, week_end, status, total_amount")
      .gte("week_start", data.from)
      .lte("week_end", data.to)
      .neq("status", "discarded")
      .order("week_start", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{
      id: string;
      week_start: string;
      week_end: string;
      status: "pending" | "paid";
      total_amount: number | string;
    }>).map((r) => ({
      id: r.id,
      weekStart: r.week_start,
      weekEnd: r.week_end,
      status: r.status,
      totalAmount: Number(r.total_amount ?? 0),
    }));
  });

// ============ Customer Report ============
export type CustomerReport = {
  newCustomers: number;
  repeatCustomers: number;
  topZones: Array<{ zoneName: string; customers: number }>;
};

export const getCustomerReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<CustomerReport> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    if (zone === "empty")
      return { newCustomers: 0, repeatCustomers: 0, topZones: [] };

    let bq = context.supabase
      .from("bookings")
      .select("user_id, zone_id, status, created_at").eq("is_training", false)
      .is("deleted_at", null)
      .not("user_id", "is", null)
      .gte("created_at", rangeFrom(data.from))
      .lte("created_at", rangeTo(data.to));
    bq = applyZone(bq, zone);
    const { data: bks, error } = await bq.limit(20000);
    if (error) throw new Error(error.message);
    const bookings = (bks ?? []) as Array<{
      user_id: string;
      zone_id: string | null;
      status: string;
    }>;

    // customer set (any booking in range, scoped)
    const customersInRange = Array.from(new Set(bookings.map((b) => b.user_id)));

    // for repeat calc: count completed bookings all-time (scoped by zone if applicable) per user
    let cq = context.supabase
      .from("bookings")
      .select("user_id, zone_id, status").eq("is_training", false)
      .is("deleted_at", null)
      .eq("status", "completed")
      .in("user_id", customersInRange.length ? customersInRange : ["00000000-0000-0000-0000-000000000000"]);
    cq = applyZone(cq, zone);
    const { data: comp } = await cq.limit(20000);
    const completedByUser = new Map<string, number>();
    for (const r of ((comp ?? []) as Array<{ user_id: string }>)) {
      completedByUser.set(r.user_id, (completedByUser.get(r.user_id) ?? 0) + 1);
    }
    const repeatCustomers = customersInRange.filter(
      (u) => (completedByUser.get(u) ?? 0) > 1,
    ).length;
    const newCustomers = customersInRange.length - repeatCustomers;

    // top zones by unique customer count
    const zoneCustomers = new Map<string | null, Set<string>>();
    for (const b of bookings) {
      const set = zoneCustomers.get(b.zone_id) ?? new Set<string>();
      set.add(b.user_id);
      zoneCustomers.set(b.zone_id, set);
    }
    const zoneIds = Array.from(zoneCustomers.keys()).filter((z): z is string => !!z);
    const zoneNameById = new Map<string, string>();
    if (zoneIds.length) {
      const { data: zs } = await context.supabase
        .from("zones")
        .select("id, name")
        .in("id", zoneIds);
      for (const z of (zs ?? []) as Array<{ id: string; name: string }>) {
        zoneNameById.set(z.id, z.name);
      }
    }
    const topZones = Array.from(zoneCustomers.entries())
      .map(([zid, set]) => ({
        zoneName: zid ? zoneNameById.get(zid) ?? "—" : "Unassigned",
        customers: set.size,
      }))
      .sort((a, b) => b.customers - a.customers)
      .slice(0, 5);

    return { newCustomers, repeatCustomers, topZones };
  });

// ============ Profit & Loss ============
export type PnlLine = {
  orders: number;
  gross: number;
  discount: number;
  coinDiscount: number;
  collected: number;
  refunds: number;
  gst: number;
  netRevenue: number;
  partnerPayout: number;
  platformEarning: number;
};
export type PnlReport = {
  services: PnlLine & { expertPayout: number };
  courier: PnlLine & { riderPayout: number };
  store: { orders: number; gross: number; refunds: number; commission: number; commissionGst: number; merchantPayout: number };
  bonuses: number;
  programCommission: number;
  paidOut: { paid: number; pending: number; tds: number };
  totals: {
    gross: number; discount: number; collected: number; refunds: number; gst: number;
    netRevenue: number; partnerPayouts: number; bonuses: number; platformProfit: number; marginPct: number;
  };
  daily: Array<{ date: string; collected: number; payouts: number; profit: number }>;
};

const emptyLine = (): PnlLine => ({
  orders: 0, gross: 0, discount: 0, coinDiscount: 0, collected: 0, refunds: 0, gst: 0,
  netRevenue: 0, partnerPayout: 0, platformEarning: 0,
});

function refundOf(r: Record<string, unknown>, charged: number) {
  const status = String(r.refund_status ?? "").toLowerCase();
  if (!status || status === "failed") return 0;
  const amt = Number(r.refund_amount ?? 0);
  if (amt > 0) return Math.min(amt, charged);
  return ["refunded", "processed", "completed", "success"].includes(status) ? charged : 0;
}

export const getPnlReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<PnlReport> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    const db = context.supabase;
    const f = rangeFrom(data.from), t = rangeTo(data.to);
    const days = new Map<string, { collected: number; payouts: number; profit: number }>();
    for (let d = new Date(data.from + "T00:00:00Z").getTime(); d <= new Date(data.to + "T00:00:00Z").getTime(); d += 86400000)
      days.set(new Date(d).toISOString().slice(0, 10), { collected: 0, payouts: 0, profit: 0 });
    const day = (iso: string) => days.get(iso.slice(0, 10));

    const services = { ...emptyLine(), expertPayout: 0 };
    const courier = { ...emptyLine(), riderPayout: 0 };
    const store = { orders: 0, gross: 0, refunds: 0, commission: 0, commissionGst: 0, merchantPayout: 0 };
    let bonuses = 0;
    let programCommission = 0;
    const paidOut = { paid: 0, pending: 0, tds: 0 };

    if (zone !== "empty") {
      let bq = db.from("bookings")
        .select("price,total_amount,discount_amount,gst_amount,refund_amount,refund_status,status,razorpay_payment_id,snapshot_expert_payout,snapshot_partner_payout,created_at")
        .eq("is_training", false).is("deleted_at", null).not("razorpay_payment_id", "is", null)
        .gte("created_at", f).lte("created_at", t);
      bq = applyZone(bq, zone);
      const { data: rows, error } = await bq.limit(20000);
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
        const pid = String(r.razorpay_payment_id ?? "");
        if (pid.toUpperCase().startsWith("TESTPRICE")) continue;
        const status = String(r.status ?? "").toLowerCase();
        const total = Number(r.total_amount ?? 0);
        const discount = Number(r.discount_amount ?? 0);
        const charged = total > 0 ? total : Math.max(0, Number(r.price ?? 0) - discount);
        const coin = pid.toLowerCase().startsWith("free_");
        services.orders += 1;
        services.gross += charged + discount;
        if (coin) { services.coinDiscount += charged; services.discount += discount; continue; }
        services.discount += discount;
        const refund = status === "cancelled" || status === "canceled" ? Math.max(refundOf(r, charged), 0) : refundOf(r, charged);
        const kept = Math.max(0, charged - refund);
        const gst = charged > 0 ? Number(r.gst_amount ?? 0) * (kept / charged) : 0;
        const done = status === "completed";
        const expert = done ? Number(r.snapshot_expert_payout ?? 0) : 0;
        const partner = done ? Number(r.snapshot_partner_payout ?? 0) : 0;
        services.collected += charged; services.refunds += refund; services.gst += gst;
        services.netRevenue += kept - gst; services.expertPayout += expert; services.partnerPayout += partner;
        const b = day(String(r.created_at));
        if (b) { b.collected += kept; b.payouts += expert + partner; b.profit += kept - gst - expert - partner; }
      }
      services.platformEarning = services.netRevenue - services.expertPayout - services.partnerPayout;
    }

    if (scope.role !== "area_partner") {
      const [co, mo, wl, pb] = await Promise.all([
        db.from("courier_orders")
          .select("total_amount,discount_amount,gst_amount,refund_amount,refund_status,razorpay_payment_id,commission_pct,status,created_at")
          .in("payment_status", ["paid", "PAID"]).gte("created_at", f).lte("created_at", t).limit(20000),
        db.from("merchant_orders")
          .select("total_amount,refund_amount,refund_status,commission_amount,commission_gst_amount,status,created_at").eq("is_training", false)
          .eq("status", "completed").gte("created_at", f).lte("created_at", t).limit(20000),
        db.from("wallet_ledger").select("amount,reason,type")
          .eq("wallet_type", "earnings").eq("type", "credit").gte("created_at", f).lte("created_at", t).limit(20000),
        db.from("payout_batch_items").select("net_amount,amount,tds_amount,paid,batch_id,payout_batches!inner(week_start,week_end,status)")
          .neq("payout_batches.status", "discarded").gte("payout_batches.week_end", data.from).lte("payout_batches.week_start", data.to).limit(20000),
      ]);
      for (const res of [co, mo, wl]) if (res.error) throw new Error(res.error.message);
      for (const r of (co.data ?? []) as Array<Record<string, unknown>>) {
        const charged = Number(r.total_amount ?? 0);
        const discount = Number(r.discount_amount ?? 0);
        courier.orders += 1; courier.gross += charged + discount;
        if (String(r.razorpay_payment_id ?? "").toLowerCase().startsWith("free_")) { courier.coinDiscount += charged; courier.discount += discount; continue; }
        courier.discount += discount;
        const refund = refundOf(r, charged);
        const kept = Math.max(0, charged - refund);
        const gst = charged > 0 ? Number(r.gst_amount ?? 0) * (kept / charged) : 0;
        const delivered = ["DELIVERED", "COMPLETED"].includes(String(r.status ?? "").toUpperCase());
        const pct = Number(r.commission_pct ?? 0);
        const rider = delivered ? (kept - gst) * (1 - pct / 100) : 0;
        courier.collected += charged; courier.refunds += refund; courier.gst += gst;
        courier.netRevenue += kept - gst; courier.riderPayout += rider;
        const b = day(String(r.created_at));
        if (b) { b.collected += kept; b.payouts += rider; b.profit += kept - gst - rider; }
      }
      courier.platformEarning = courier.netRevenue - courier.riderPayout;
      for (const r of (mo.data ?? []) as Array<Record<string, unknown>>) {
        const total = Number(r.total_amount ?? 0);
        const refund = refundOf(r, total);
        const comm = Number(r.commission_amount ?? 0);
        const cgst = Number(r.commission_gst_amount ?? 0);
        store.orders += 1; store.gross += total; store.refunds += refund;
        store.commission += comm; store.commissionGst += cgst;
        store.merchantPayout += Math.max(0, total - refund - comm - cgst);
        const b = day(String(r.created_at));
        if (b) { b.collected += total - refund; b.payouts += Math.max(0, total - refund - comm - cgst); b.profit += comm; }
      }
      for (const r of (wl.data ?? []) as Array<{ amount: number; reason: string | null }>) {
        if (/bonus|incentive|reward|milestone/i.test(r.reason ?? "")) bonuses += Number(r.amount ?? 0);
      }
      if (!pb.error) for (const r of (pb.data ?? []) as Array<Record<string, unknown>>) {
        const net = Number(r.net_amount ?? r.amount ?? 0);
        paidOut.tds += Number(r.tds_amount ?? 0);
        if (r.paid) paidOut.paid += net; else paidOut.pending += net;
      }
      const ppb = await db.from("partner_payout_batches").select("total_gross,total_tds,total_net,status,period_start,period_end")
        .in("status", ["draft", "approved", "paid"]).gte("period_end", data.from).lte("period_start", data.to).limit(5000);
      if (!ppb.error) for (const r of (ppb.data ?? []) as Array<Record<string, unknown>>) {
        programCommission += Number(r.total_gross ?? 0);
        paidOut.tds += Number(r.tds_amount ?? 0);
        if (r.status === "paid") paidOut.paid += Number(r.net_amount ?? 0); else paidOut.pending += Number(r.net_amount ?? 0);
      }
    }

    const netRevenue = services.netRevenue + courier.netRevenue + store.commission;
    const partnerPayouts = services.expertPayout + services.partnerPayout + courier.riderPayout + programCommission;
    const platformProfit = netRevenue - partnerPayouts - bonuses;
    return {
      services, courier, store, bonuses, paidOut, programCommission,
      totals: {
        gross: services.gross + courier.gross + store.gross,
        discount: services.discount + services.coinDiscount + courier.discount + courier.coinDiscount,
        collected: services.collected + courier.collected + store.gross,
        refunds: services.refunds + courier.refunds + store.refunds,
        gst: services.gst + courier.gst + store.commissionGst,
        netRevenue, partnerPayouts, bonuses, platformProfit,
        marginPct: netRevenue > 0 ? (platformProfit / netRevenue) * 100 : 0,
      },
      daily: Array.from(days.entries()).map(([date, v]) => ({ date, ...v })),
    };
  });
