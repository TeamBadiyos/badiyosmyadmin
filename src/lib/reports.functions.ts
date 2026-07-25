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
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status, zone_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  return {
    role: data.role as StaffRole,
    zone_id: (data.zone_id as string | null) ?? null,
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
  scope: { role: StaffRole; zone_id: string | null },
  requestedZoneId: string | null | undefined,
): string | null | "empty" {
  if (scope.role === "area_partner") {
    if (!scope.zone_id) return "empty";
    return scope.zone_id;
  }
  return requestedZoneId ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyZone(q: any, zoneId: string | null) {
  return zoneId ? q.eq("zone_id", zoneId) : q;
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
};

export const getRevenueReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<RevenueReport> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    if (zone === "empty") return { summary: { totalRevenue: 0, paidBookings: 0, avgDaily: 0 }, daily: [] };

    let q = context.supabase
      .from("bookings")
      .select("price, created_at, razorpay_payment_id, zone_id")
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
    for (const r of (rows ?? []) as Array<{ price: number | null; created_at: string }>) {
      const day = r.created_at.slice(0, 10);
      const bucket = map.get(day) ?? { revenue: 0, bookings: 0 };
      const p = Number(r.price ?? 0);
      bucket.revenue += p;
      bucket.bookings += 1;
      map.set(day, bucket);
      total += p;
      count += 1;
    }
    const daily = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, revenue: v.revenue, bookings: v.bookings }));
    const days = Math.max(1, daily.length);
    return {
      summary: { totalRevenue: total, paidBookings: count, avgDaily: total / days },
      daily,
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
      .select("id, status, zone_id, cancellation_reason, created_at")
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
      .select("assigned_expert_id, zone_id, updated_at, status")
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
    if (zone) eq = eq.eq("zone_id", zone);
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

// ============ Area Partner Performance ============
export type PartnerPerformanceRow = {
  partnerId: string;
  name: string;
  zoneName: string;
  bookings: number;
  commission: number;
  setupFeeStatus: string;
};

export const getPartnerPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ReportRange | undefined) => validateRange(i))
  .handler(async ({ data, context }): Promise<PartnerPerformanceRow[]> => {
    const scope = await getScope(context.supabase, context.userId);
    const zone = scopeZone(scope, data.zoneId);
    if (zone === "empty") return [];

    let zq = context.supabase.from("zones").select("id, name, assigned_area_partner_id");
    if (zone) zq = zq.eq("id", zone);
    const { data: zones } = await zq.limit(5000);
    const zoneRows = ((zones ?? []) as Array<{
      id: string;
      name: string;
      assigned_area_partner_id: string | null;
    }>).filter((z) => !!z.assigned_area_partner_id);
    if (!zoneRows.length) return [];

    const zoneIds = zoneRows.map((z) => z.id);
    const partnerIds = Array.from(
      new Set(zoneRows.map((z) => z.assigned_area_partner_id!).filter(Boolean)),
    );

    const { data: partners } = await context.supabase
      .from("area_partners")
      .select("id, name, setup_fee_status, commission_rate")
      .in("id", partnerIds);
    const partnerMap = new Map(
      ((partners ?? []) as Array<{
        id: string;
        name: string;
        setup_fee_status: string;
        commission_rate: number | string;
      }>).map((p) => [p.id, p]),
    );

    const { data: bks } = await context.supabase
      .from("bookings")
      .select("zone_id, service_duration_minutes, status, updated_at")
      .is("deleted_at", null)
      .eq("status", "completed")
      .in("zone_id", zoneIds)
      .gte("updated_at", rangeFrom(data.from))
      .lte("updated_at", rangeTo(data.to))
      .limit(10000);
    const bookings = (bks ?? []) as Array<{
      zone_id: string;
      service_duration_minutes: number | null;
    }>;

    // service payouts
    const durations = Array.from(
      new Set(bookings.map((b) => b.service_duration_minutes).filter((d): d is number => !!d)),
    );
    const payoutByDuration = new Map<number, number>();
    if (durations.length) {
      const { data: sc } = await context.supabase
        .from("service_catalogue_config")
        .select("duration_minutes, area_partner_payout")
        .in("duration_minutes", durations);
      for (const s of (sc ?? []) as Array<{
        duration_minutes: number;
        area_partner_payout: number | string | null;
      }>) {
        payoutByDuration.set(s.duration_minutes, Number(s.area_partner_payout ?? 0));
      }
    }

    // aggregate per zone → partner
    const perPartner = new Map<
      string,
      { bookings: number; commission: number; zones: string[] }
    >();
    for (const z of zoneRows) {
      const pid = z.assigned_area_partner_id!;
      const cur = perPartner.get(pid) ?? { bookings: 0, commission: 0, zones: [] };
      cur.zones.push(z.name);
      perPartner.set(pid, cur);
    }
    for (const b of bookings) {
      const z = zoneRows.find((zr) => zr.id === b.zone_id);
      if (!z) continue;
      const pid = z.assigned_area_partner_id!;
      const cur = perPartner.get(pid);
      if (!cur) continue;
      cur.bookings += 1;
      cur.commission += payoutByDuration.get(b.service_duration_minutes ?? -1) ?? 0;
    }

    const rows: PartnerPerformanceRow[] = Array.from(perPartner.entries()).map(
      ([pid, agg]) => {
        const p = partnerMap.get(pid);
        return {
          partnerId: pid,
          name: p?.name ?? "—",
          zoneName: agg.zones.join(", "),
          bookings: agg.bookings,
          commission: agg.commission,
          setupFeeStatus: p?.setup_fee_status ?? "—",
        };
      },
    );
    rows.sort((a, b) => b.bookings - a.bookings || b.commission - a.commission);
    return rows;
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
      .select("user_id, zone_id, status, created_at")
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
      .select("user_id, zone_id, status")
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
