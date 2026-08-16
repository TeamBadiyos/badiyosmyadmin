import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardStats = {
  todayRevenue: number;
  todayTransactions: number;
  activeNow: number;
  completedToday: number;
  pendingAction: number;
  onlineNow: number;
  // breakdown (used for tooltips / drilldowns)
  todayBookings: number;
  todayOrders: number;
  onlineExperts: number;
  openMerchants: number;
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { segmentId?: string | null }) => ({
    segmentId: input?.segmentId ?? null,
  }))
  .handler(async ({ data, context }): Promise<DashboardStats> => {
    // Authorize: caller must be an active staff user.
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("id, status")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staff || staff.status !== "active") {
      throw new Error("Forbidden");
    }

    const db = context.supabase;
    const segmentId = data.segmentId;

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();
    const endOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).toISOString();

    // Resolve segment scoping ids.
    let categoryIds: string[] | null = null;
    let merchantIds: string[] | null = null;
    if (segmentId) {
      const [catsRes, merchRes] = await Promise.all([
        db.from("service_categories").select("id").eq("segment_id", segmentId),
        db.from("merchants").select("id").eq("segment_id", segmentId),
      ]);
      if (catsRes.error) throw catsRes.error;
      if (merchRes.error) throw merchRes.error;
      categoryIds = (catsRes.data ?? []).map((r) => r.id as string);
      merchantIds = (merchRes.data ?? []).map((r) => r.id as string);
    }

    const countOnly = { count: "exact" as const, head: true };
    const scopeBookings = <T extends { in: (c: string, v: string[]) => T }>(
      q: T,
    ): T => (categoryIds ? q.in("service_category_id", categoryIds) : q);
    const scopeMerchant = <T extends { in: (c: string, v: string[]) => T }>(
      q: T,
    ): T => (merchantIds ? q.in("merchant_id", merchantIds) : q);

    const emptyCount = { count: 0, data: [], error: null } as const;
    const noBookings = categoryIds !== null && categoryIds.length === 0;
    const noMerchants = merchantIds !== null && merchantIds.length === 0;

    const [
      todayBookingsRes,
      bookingRevenueRes,
      activeBookingsRes,
      completedBookingsRes,
      pendingBookingsRes,
      expertsRes,
      todayOrdersRes,
      orderRevenueRes,
      activeOrdersRes,
      completedOrdersRes,
      pendingOrdersRes,
      openMerchantsRes,
      offlineRevenueRes,
    ] = await Promise.all([
      noBookings
        ? emptyCount
        : scopeBookings(
            db
              .from("bookings")
              .select("*", countOnly)
              .is("deleted_at", null)
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay),
          ),
      noBookings
        ? emptyCount
        : scopeBookings(
            db
              .from("bookings")
              .select("price")
              .is("deleted_at", null)
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay)
              .not("razorpay_payment_id", "is", null),
          ),
      noBookings
        ? emptyCount
        : scopeBookings(
            db
              .from("bookings")
              .select("*", countOnly)
              .is("deleted_at", null)
              .eq("status", "in_progress"),
          ),
      noBookings
        ? emptyCount
        : scopeBookings(
            db
              .from("bookings")
              .select("*", countOnly)
              .is("deleted_at", null)
              .eq("status", "completed")
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay),
          ),
      noBookings
        ? emptyCount
        : scopeBookings(
            db
              .from("bookings")
              .select("*", countOnly)
              .is("deleted_at", null)
              .in("status", ["confirmed", "accepted"]),
          ),
      db
        .from("experts")
        .select("*", countOnly)
        .eq("status", "active")
        .eq("is_online", true),
      noMerchants
        ? emptyCount
        : scopeMerchant(
            db
              .from("merchant_orders")
              .select("*", countOnly)
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay),
          ),
      noMerchants
        ? emptyCount
        : scopeMerchant(
            db
              .from("merchant_orders")
              .select("total_amount")
              .eq("status", "completed")
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay),
          ),
      noMerchants
        ? emptyCount
        : scopeMerchant(
            db
              .from("merchant_orders")
              .select("*", countOnly)
              .in("status", ["accepted", "preparing", "ready"]),
          ),
      noMerchants
        ? emptyCount
        : scopeMerchant(
            db
              .from("merchant_orders")
              .select("*", countOnly)
              .eq("status", "completed")
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay),
          ),
      noMerchants
        ? emptyCount
        : scopeMerchant(
            db
              .from("merchant_orders")
              .select("*", countOnly)
              .eq("status", "pending"),
          ),
      noMerchants
        ? emptyCount
        : (() => {
            let q = db
              .from("merchants")
              .select("*", countOnly)
              .eq("status", "approved")
              .eq("is_accepting_orders", true);
            if (merchantIds) q = q.in("id", merchantIds);
            return q;
          })(),
      noMerchants
        ? emptyCount
        : scopeMerchant(
            db
              .from("offline_sales")
              .select("total_amount")
              .gte("created_at", startOfDay)
              .lt("created_at", endOfDay)
              .limit(1000),
          ),
    ]);

    for (const res of [
      todayBookingsRes,
      bookingRevenueRes,
      activeBookingsRes,
      completedBookingsRes,
      pendingBookingsRes,
      expertsRes,
      todayOrdersRes,
      orderRevenueRes,
      activeOrdersRes,
      completedOrdersRes,
      pendingOrdersRes,
      openMerchantsRes,
      offlineRevenueRes,
    ]) {
      if (res.error) throw res.error;
    }

    const sum = (rows: unknown, key: string) =>
      ((rows ?? []) as Array<Record<string, unknown>>).reduce(
        (acc, row) => acc + Number(row[key] ?? 0),
        0,
      );

    const bookingRevenue = sum(bookingRevenueRes.data, "price");
    const orderRevenue = sum(orderRevenueRes.data, "total_amount");
    const offlineRevenue = sum(offlineRevenueRes.data, "total_amount");

    const todayBookings = todayBookingsRes.count ?? 0;
    const todayOrders = todayOrdersRes.count ?? 0;
    const onlineExperts = expertsRes.count ?? 0;
    const openMerchants = openMerchantsRes.count ?? 0;

    return {
      todayRevenue: bookingRevenue + orderRevenue + offlineRevenue,
      todayTransactions: todayBookings + todayOrders,
      activeNow: (activeBookingsRes.count ?? 0) + (activeOrdersRes.count ?? 0),
      completedToday:
        (completedBookingsRes.count ?? 0) + (completedOrdersRes.count ?? 0),
      pendingAction:
        (pendingBookingsRes.count ?? 0) + (pendingOrdersRes.count ?? 0),
      onlineNow: onlineExperts + openMerchants,
      todayBookings,
      todayOrders,
      onlineExperts,
      openMerchants,
    };
  });
