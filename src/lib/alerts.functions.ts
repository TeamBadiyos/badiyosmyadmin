import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AlertKind = "support" | "needs_expert" | "emergency" | "extension";

export type StaffAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  createdAt: string;
  /** Nav key of the Command Center screen this alert links to. */
  target: "support" | "bookings" | "emergency" | "dashboard";
  bookingId?: string | null;
};

export type StaffAlerts = {
  openTickets: number;
  needsExpert: number;
  emergencies: number;
  pendingExtensions: number;
  total: number;
  items: StaffAlert[];
};

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const getStaffAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffAlerts> => {
    const { data: staff } = await context.supabase
      .from("staff_users")
      .select("role, status")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!staff || staff.status !== "active") throw new Error("Forbidden");
    const canSeeTickets = staff.role === "super_admin" || staff.role === "ops_manager";

    const [ticketsRes, bookingsRes, emergencyRes, extRes] = await Promise.all([
      canSeeTickets
        ? context.supabase
            .from("support_tickets")
            .select("id, message, source, created_at")
            .in("status", ["open", "in_progress"])
            .order("created_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      context.supabase
        .from("bookings")
        .select("id, service_label, created_at, dispatch_exhausted_at")
        .in("status", ["confirmed", "accepted"])
        .is("assigned_expert_id", null)
        .is("deleted_at", null)
        .not("dispatch_exhausted_at", "is", null)
        .order("dispatch_exhausted_at", { ascending: false })
        .limit(10),
      context.supabase
        .from("emergency_alerts")
        .select("id, notes, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(10),
      context.supabase
        .from("booking_extensions")
        .select("id, booking_id, extra_minutes, created_at")
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tickets = (ticketsRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookings = (bookingsRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emergencies = (emergencyRes.data ?? []) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extensions = (extRes.data ?? []) as any[];

    const items: StaffAlert[] = [
      ...emergencies.map((e) => ({
        id: `emg-${e.id}`,
        kind: "emergency" as const,
        title: "Emergency alert",
        detail: e.notes ?? "An expert raised an emergency alert.",
        createdAt: e.created_at,
        target: "emergency" as const,
      })),
      ...bookings.map((b) => ({
        id: `bk-${b.id}`,
        kind: "needs_expert" as const,
        title: "Booking needs an expert",
        detail: `${b.service_label ?? "Booking"} — no expert accepted nearby (${fmtWhen(
          b.dispatch_exhausted_at ?? b.created_at,
        )})`,
        createdAt: b.dispatch_exhausted_at ?? b.created_at,
        target: "bookings" as const,
        bookingId: b.id as string,
      })),
      ...tickets.map((t) => ({
        id: `tk-${t.id}`,
        kind: "support" as const,
        title: `Support ticket (${t.source ?? "customer"})`,
        detail: String(t.message ?? "").slice(0, 120),
        createdAt: t.created_at,
        target: "support" as const,
      })),
      ...extensions.map((x) => ({
        id: `ex-${x.id}`,
        kind: "extension" as const,
        title: "Extension awaiting approval",
        detail: `Customer requested +${x.extra_minutes} minutes.`,
        createdAt: x.created_at,
        target: "bookings" as const,
        bookingId: x.booking_id as string,
      })),
    ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return {
      openTickets: tickets.length,
      needsExpert: bookings.length,
      emergencies: emergencies.length,
      pendingExtensions: extensions.length,
      total: items.length,
      items: items.slice(0, 20),
    };
  });
