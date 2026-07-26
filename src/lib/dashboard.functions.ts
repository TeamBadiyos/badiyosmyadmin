import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DashboardStats = {
  todayBookings: number;
  todayRevenue: number;
  activeBookings: number;
  completedToday: number;
  pendingAssignment: number;
  onlineExperts: number;
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
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

    const countOnly = { count: "exact" as const, head: true };

    const [
      todayBookingsRes,
      revenueRes,
      activeRes,
      completedRes,
      pendingRes,
      expertsRes,
    ] = await Promise.all([
      db
        .from("bookings")
        .select("*", countOnly)
        .is("deleted_at", null)
        .gte("created_at", startOfDay)
        .lt("created_at", endOfDay),
      db
        .from("bookings")
        .select("price")
        .is("deleted_at", null)
        .gte("created_at", startOfDay)
        .lt("created_at", endOfDay)
        .not("razorpay_payment_id", "is", null),
      db
        .from("bookings")
        .select("*", countOnly)
        .is("deleted_at", null)
        .in("status", ["expert_assigned", "in_progress"]),
      db
        .from("bookings")
        .select("*", countOnly)
        .is("deleted_at", null)
        .eq("status", "completed")
        .gte("created_at", startOfDay)
        .lt("created_at", endOfDay),
      db
        .from("bookings")
        .select("*", countOnly)
        .is("deleted_at", null)
        .eq("status", "confirmed"),
      db
        .from("experts")
        .select("*", countOnly)
        .eq("status", "active")
        .eq("is_online", true),
    ]);

    for (const res of [todayBookingsRes, revenueRes, activeRes, completedRes, pendingRes, expertsRes]) {
      if (res.error) throw res.error;
    }

    const revenue = (revenueRes.data ?? []).reduce(
      (sum, row) => sum + Number(row.price ?? 0),
      0,
    );

    return {
      todayBookings: todayBookingsRes.count ?? 0,
      todayRevenue: revenue,
      activeBookings: activeRes.count ?? 0,
      completedToday: completedRes.count ?? 0,
      pendingAssignment: pendingRes.count ?? 0,
      onlineExperts: expertsRes.count ?? 0,
    };
  });
