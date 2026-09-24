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
  courierToday: number;
  courierRevenue: number;
  onlineExperts: number;
  // offers & campaigns
  couponsUsed: number;
  discountGiven: number;
  activeCampaigns: number;
  rewardsIssued: number;
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

    // Offers & campaigns (not segment-scoped)
    const [redemptionsRes, activeCampaignsRes, awardsRes] = await Promise.all([
      db.from("coupon_redemptions").select("discount_amount").eq("status", "applied").limit(10000),
      db
        .from("marketing_campaigns")
        .select("*", countOnly)
        .eq("status", "sent")
        .eq("show_in_offers", true),
      db.from("referral_milestone_awards").select("*", countOnly),
    ]);

    // Courier (parcel delivery) orders — shown alongside service bookings.
    const COURIER_ACTIVE = [
      "DRIVER_ASSIGNED",
      "ASSIGNED",
      "ARRIVED_PICKUP",
      "PICKED_UP",
      "IN_TRANSIT",
    ];
    const COURIER_DONE = ["DELIVERED", "COMPLETED"];
    const [
      courierTodayRes,
      courierRevenueRes,
      courierActiveRes,
      courierDoneRes,
      courierPendingRes,
    ] = await Promise.all([
      db
        .from("courier_orders")
        .select("*", countOnly)
        .gte("created_at", startOfDay)
        .lt("created_at", endOfDay),
      db
        .from("courier_orders")
        .select("total_amount")
        .in("payment_status", ["paid", "PAID"])
        .gte("created_at", startOfDay)
        .lt("created_at", endOfDay)
        .limit(1000),
      db.from("courier_orders").select("*", countOnly).in("status", COURIER_ACTIVE),
      db
        .from("courier_orders")
        .select("*", countOnly)
        .in("status", COURIER_DONE)
        .gte("created_at", startOfDay)
        .lt("created_at", endOfDay),
      db
        .from("courier_orders")
        .select("*", countOnly)
        .in("status", ["REQUESTED", "SEARCHING"]),
    ]);


    const courierRevenue = sum(courierRevenueRes.data, "total_amount");
    const courierToday = courierTodayRes.count ?? 0;

    const redemptionRows = (redemptionsRes.data ?? []) as Array<{ discount_amount: number }>;

    return {
      todayRevenue: bookingRevenue + orderRevenue + offlineRevenue + courierRevenue,
      todayTransactions: todayBookings + todayOrders + courierToday,
      activeNow:
        (activeBookingsRes.count ?? 0) +
        (activeOrdersRes.count ?? 0) +
        (courierActiveRes.count ?? 0),
      completedToday:
        (completedBookingsRes.count ?? 0) +
        (completedOrdersRes.count ?? 0) +
        (courierDoneRes.count ?? 0),
      pendingAction:
        (pendingBookingsRes.count ?? 0) +
        (pendingOrdersRes.count ?? 0) +
        (courierPendingRes.count ?? 0),
      onlineNow: onlineExperts + openMerchants,
      todayBookings,
      todayOrders,
      courierToday,
      courierRevenue,
      onlineExperts,
      openMerchants,
      couponsUsed: redemptionRows.length,
      discountGiven: redemptionRows.reduce((a, r) => a + Number(r.discount_amount ?? 0), 0),
      activeCampaigns: activeCampaignsRes.count ?? 0,
      rewardsIssued: awardsRes.count ?? 0,
    };
  });

