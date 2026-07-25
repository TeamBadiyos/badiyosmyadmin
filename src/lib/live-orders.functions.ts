import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PendingBooking = {
  id: string;
  customerName: string;
  serviceLabel: string | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  addressShort: string;
  createdAt: string;
};

export const REJECT_REASONS = [
  "CHANGED_MIND",
  "NO_RESPONSE",
  "DUPLICATE",
  "OTHER",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

async function assertActiveStaff(context: {
  supabase: { from: (t: string) => any };
  userId: string;
}) {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("id, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") throw new Error("Forbidden");
}

export const listPendingBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingBooking[]> => {
    await assertActiveStaff(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: bookings, error } = await supabaseAdmin
      .from("bookings")
      .select(
        "id, user_id, address_id, service_label, scheduled_date, scheduled_time_slot, created_at",
      )
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = bookings ?? [];
    if (rows.length === 0) return [];

    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const addressIds = Array.from(
      new Set(rows.map((r) => r.address_id).filter(Boolean) as string[]),
    );

    const [usersRes, addrRes] = await Promise.all([
      supabaseAdmin.from("users").select("id, full_name").in("id", userIds),
      addressIds.length
        ? supabaseAdmin
            .from("addresses")
            .select("id, label, area, city, full_address")
            .in("id", addressIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (usersRes.error) throw usersRes.error;
    if ("error" in addrRes && addrRes.error) throw addrRes.error;

    const userMap = new Map(
      (usersRes.data ?? []).map((u: any) => [u.id, u.full_name as string | null]),
    );
    const addrMap = new Map(
      ((addrRes.data ?? []) as any[]).map((a) => [a.id, a]),
    );

    return rows.map((r) => {
      const addr = r.address_id ? addrMap.get(r.address_id) : null;
      const addressShort = addr
        ? [addr.label, addr.area, addr.city].filter(Boolean).join(", ") ||
          (addr.full_address ?? "")
        : "";
      return {
        id: r.id as string,
        customerName: (userMap.get(r.user_id) as string | null) ?? "Customer",
        serviceLabel: (r.service_label as string | null) ?? null,
        scheduledDate: (r.scheduled_date as string | null) ?? null,
        scheduledTimeSlot: (r.scheduled_time_slot as string | null) ?? null,
        addressShort,
        createdAt: r.created_at as string,
      };
    });
  });

export const acceptPendingBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) => {
    if (!input?.bookingId || typeof input.bookingId !== "string") {
      throw new Error("bookingId required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_accept_booking", {
      _booking_id: data.bookingId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const rejectPendingBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; reason: RejectReason }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    if (!REJECT_REASONS.includes(input.reason)) {
      throw new Error("Invalid reason");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_reject_booking", {
      _booking_id: data.bookingId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
