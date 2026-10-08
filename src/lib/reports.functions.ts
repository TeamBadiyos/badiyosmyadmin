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
      .select("assigned_expert_id, zone_id, updated_at, status, snapshot_expert_payout").eq("is_training", false)
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

    // service earnings only (rider/delivery work is reported separately)
    const earnings = new Map<string, number>();
    for (const r of (rows ?? []) as Array<{ assigned_expert_id: string; snapshot_expert_payout: number | null }>) {
      earnings.set(r.assigned_expert_id, (earnings.get(r.assigned_expert_id) ?? 0) + Number(r.snapshot_expert_payout ?? 0));
    }

    const result: ExpertPerformanceRow[] = expertList.filter((e) => completedByExpert.has(e.id)).map((e) => ({
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
    netRevenue: number; partnerPayouts: number; bonuses: number; platformProfit: number; marginPct: number; grossProfit: number; grossPct: number;
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
        paidOut.tds += Number(r.total_tds ?? 0);
        if (r.status === "paid") paidOut.paid += Number(r.total_net ?? 0); else paidOut.pending += Number(r.total_net ?? 0);
      }
    }

    const netRevenue = services.netRevenue + courier.netRevenue + store.commission;
    const partnerPayouts = services.expertPayout + services.partnerPayout + courier.riderPayout + programCommission;
    const platformProfit = netRevenue - partnerPayouts - bonuses;
    const grossProfit = netRevenue - services.expertPayout - services.partnerPayout - courier.riderPayout;
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
        grossProfit,
        grossPct: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
      },
      daily: Array.from(days.entries()).map(([date, v]) => ({ date, ...v })),
    };
  });

// ============ Riders (delivery work, separate from service Experts) ============
export type RiderKind = "Delivery" | "Store delivery" | "Bulk delivery";
export type RiderReportRow = {
  riderId: string; name: string; orders: number; delivery: number; store: number; bulk: number;
  collected: number; riderPayout: number; platformEarning: number;
};
export type RiderReport = {
  rows: RiderReportRow[];
  byKind: Array<{ kind: RiderKind; orders: number; collected: number; riderPayout: number; platformEarning: number }>;
};

export const getRiderReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<RiderReport> => {
    const scope = await getScope(context.supabase, context.userId);
    const empty: RiderReport = { rows: [], byKind: [] };
    if (scope.role === "area_partner") return empty;
    const db = context.supabase;
    let q = db.from("courier_orders")
      .select("assigned_expert_id,business_merchant_id,merchant_order_id,store_order_id,total_amount,gst_amount,refund_amount,refund_status,commission_pct,status,razorpay_payment_id,zone_id")
      .in("payment_status", ["paid", "PAID"]).gte("created_at", rangeFrom(data.from)).lte("created_at", rangeTo(data.to));
    if (data.zoneId) q = q.eq("zone_id", data.zoneId);
    const { data: rows, error } = await q.limit(20000);
    if (error) throw new Error(error.message);
    const per = new Map<string, RiderReportRow>();
    const kinds = new Map<RiderKind, { orders: number; collected: number; riderPayout: number; platformEarning: number }>();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      if (!["DELIVERED", "COMPLETED"].includes(String(r.status ?? "").toUpperCase())) continue;
      if (String(r.razorpay_payment_id ?? "").toLowerCase().startsWith("free_")) continue;
      const charged = Number(r.total_amount ?? 0);
      const kept = Math.max(0, charged - refundOf(r, charged));
      const gst = charged > 0 ? Number(r.gst_amount ?? 0) * (kept / charged) : 0;
      const net = kept - gst;
      const rider = net * (1 - Number(r.commission_pct ?? 0) / 100);
      const kind: RiderKind = r.business_merchant_id ? "Bulk delivery" : (r.merchant_order_id || r.store_order_id) ? "Store delivery" : "Delivery";
      const k = kinds.get(kind) ?? { orders: 0, collected: 0, riderPayout: 0, platformEarning: 0 };
      k.orders += 1; k.collected += kept; k.riderPayout += rider; k.platformEarning += net - rider;
      kinds.set(kind, k);
      const id = String(r.assigned_expert_id ?? "");
      if (!id) continue;
      const row = per.get(id) ?? { riderId: id, name: "—", orders: 0, delivery: 0, store: 0, bulk: 0, collected: 0, riderPayout: 0, platformEarning: 0 };
      row.orders += 1;
      if (kind === "Delivery") row.delivery += 1; else if (kind === "Store delivery") row.store += 1; else row.bulk += 1;
      row.collected += kept; row.riderPayout += rider; row.platformEarning += net - rider;
      per.set(id, row);
    }
    const ids = Array.from(per.keys());
    if (ids.length) {
      const { data: ex } = await db.from("experts").select("id,name").in("id", ids);
      for (const e of (ex ?? []) as Array<{ id: string; name: string }>) { const r = per.get(e.id); if (r) r.name = e.name; }
    }
    return {
      rows: Array.from(per.values()).sort((a, b) => b.orders - a.orders),
      byKind: (["Delivery", "Store delivery", "Bulk delivery"] as RiderKind[]).map((kind) => ({ kind, ...(kinds.get(kind) ?? { orders: 0, collected: 0, riderPayout: 0, platformEarning: 0 }) })),
    };
  });

// ============ Store-wise commission ============
export type StoreReportRow = {
  merchantId: string; storeName: string; orders: number; sales: number; refunds: number;
  commission: number; commissionGst: number; merchantPayout: number; commissionPct: number;
};

export const getStoreReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<StoreReportRow[]> => {
    const scope = await getScope(context.supabase, context.userId);
    if (scope.role === "area_partner") return [];
    const db = context.supabase;
    const { data: rows, error } = await db.from("merchant_orders")
      .select("merchant_id,total_amount,refund_amount,refund_status,commission_amount,commission_gst_amount")
      .eq("is_training", false).eq("status", "completed")
      .gte("created_at", rangeFrom(data.from)).lte("created_at", rangeTo(data.to)).limit(20000);
    if (error) throw new Error(error.message);
    const per = new Map<string, StoreReportRow>();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const id = String(r.merchant_id ?? "");
      const total = Number(r.total_amount ?? 0);
      const refund = refundOf(r, total);
      const comm = Number(r.commission_amount ?? 0), cg = Number(r.commission_gst_amount ?? 0);
      const row = per.get(id) ?? { merchantId: id, storeName: "—", orders: 0, sales: 0, refunds: 0, commission: 0, commissionGst: 0, merchantPayout: 0, commissionPct: 0 };
      row.orders += 1; row.sales += total; row.refunds += refund; row.commission += comm; row.commissionGst += cg;
      row.merchantPayout += Math.max(0, total - refund - comm - cg);
      per.set(id, row);
    }
    const ids = Array.from(per.keys()).filter(Boolean);
    if (ids.length) {
      const { data: ms } = await db.from("merchants").select("id,store_name,owner_name").in("id", ids);
      for (const m of (ms ?? []) as Array<{ id: string; store_name: string | null; owner_name: string | null }>) {
        const r = per.get(m.id); if (r) r.storeName = m.store_name || m.owner_name || "—";
      }
    }
    return Array.from(per.values()).map((r) => ({ ...r, commissionPct: r.sales > 0 ? (r.commission / r.sales) * 100 : 0 }))
      .sort((a, b) => b.commission - a.commission);
  });

// ============ All payout batches (Experts & Riders, Stores, Area Partners) ============
export type PayoutOverviewRow = {
  id: string; group: "Experts & Riders" | "Stores" | "Area Partners"; from: string; to: string;
  status: string; gross: number; tds: number; net: number; batchType?: "expert" | "merchant";
};

export const getPayoutOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<PayoutOverviewRow[]> => {
    const scope = await getScope(context.supabase, context.userId);
    if (scope.role === "area_partner") return [];
    const db = context.supabase;
    const [pb, items, ppb] = await Promise.all([
      db.from("payout_batches").select("id,week_start,week_end,status,total_amount,batch_type")
        .neq("status", "discarded").gte("week_end", data.from).lte("week_start", data.to).limit(1000),
      db.from("payout_batch_items").select("batch_id,tds_amount,net_amount,gross_amount,amount,removed").limit(20000),
      db.from("partner_payout_batches").select("id,period_start,period_end,status,total_gross,total_tds,total_net,deleted_at")
        .is("deleted_at", null).gte("period_end", data.from).lte("period_start", data.to).limit(1000),
    ]);
    if (pb.error) throw new Error(pb.error.message);
    const agg = new Map<string, { tds: number; net: number; gross: number }>();
    for (const it of (items.data ?? []) as Array<Record<string, unknown>>) {
      if (it.removed) continue;
      const k = String(it.batch_id);
      const a = agg.get(k) ?? { tds: 0, net: 0, gross: 0 };
      a.tds += Number(it.tds_amount ?? 0);
      a.net += Number(it.net_amount ?? it.amount ?? 0);
      a.gross += Number(it.gross_amount ?? it.amount ?? 0);
      agg.set(k, a);
    }
    const out: PayoutOverviewRow[] = [];
    for (const r of (pb.data ?? []) as Array<Record<string, unknown>>) {
      const a = agg.get(String(r.id));
      const total = Number(r.total_amount ?? 0);
      const bt = (r.batch_type ?? "expert") as "expert" | "merchant";
      out.push({ id: String(r.id), group: bt === "merchant" ? "Stores" : "Experts & Riders", from: String(r.week_start), to: String(r.week_end),
        status: String(r.status), gross: a?.gross || total, tds: a?.tds ?? 0, net: a?.net || total, batchType: bt });
    }
    for (const r of (ppb.data ?? []) as Array<Record<string, unknown>>) {
      out.push({ id: String(r.id), group: "Area Partners", from: String(r.period_start), to: String(r.period_end), status: String(r.status),
        gross: Number(r.total_gross ?? 0), tds: Number(r.total_tds ?? 0), net: Number(r.total_net ?? 0) });
    }
    return out.sort((a, b) => b.from.localeCompare(a.from));
  });
