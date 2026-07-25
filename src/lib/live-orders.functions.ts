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
    const db = context.supabase;

    const { data: bookings, error } = await db
      .from("bookings")
      .select(
        "id, user_id, address_id, service_label, scheduled_date, scheduled_time_slot, created_at",
      )
      .eq("status", "confirmed")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = bookings ?? [];
    if (rows.length === 0) return [];

    const userIds = Array.from(
      new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id)),
    );
    const addressIds = Array.from(
      new Set(rows.map((r) => r.address_id).filter(Boolean) as string[]),
    );

    const [usersRes, addrRes] = await Promise.all([
      db.from("users").select("id, full_name").in("id", userIds),
      addressIds.length
        ? db
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

export type ActiveExpert = {
  id: string;
  name: string;
  phone: string;
  distanceKm: number | null;
};

// Radius-based eligible experts for a booking (uses dispatch_config radius
// via the get_eligible_experts_for_booking RPC). If no bookingId is provided
// (rare — generic list), falls back to all active experts (no distance).
export const listActiveExperts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { bookingId?: string | null }) => ({
    bookingId: input?.bookingId ?? null,
  }))
  .handler(async ({ data, context }): Promise<ActiveExpert[]> => {
    await assertActiveStaff(context);
    const db = context.supabase;

    if (data.bookingId) {
      const { data: eligible, error: rpcErr } = await db.rpc(
        "get_eligible_experts_for_booking",
        { p_booking_id: data.bookingId },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      const rows = (eligible ?? []) as Array<{
        expert_id: string;
        distance_km: number | string | null;
      }>;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.expert_id);
      const { data: experts, error } = await db
        .from("experts")
        .select("id, name, phone")
        .in("id", ids);
      if (error) throw new Error(error.message);
      const map = new Map(
        ((experts ?? []) as Array<{ id: string; name: string; phone: string }>)
          .map((e) => [e.id, e]),
      );
      return rows
        .map((r) => {
          const ex = map.get(r.expert_id);
          if (!ex) return null;
          const d = r.distance_km == null ? null : Number(r.distance_km);
          return {
            id: ex.id,
            name: ex.name,
            phone: ex.phone,
            distanceKm: Number.isFinite(d as number) ? (d as number) : null,
          };
        })
        .filter((e): e is ActiveExpert => e !== null);
    }

    const { data: rows, error } = await db
      .from("experts")
      .select("id, name, phone")
      .eq("status", "active")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{ id: string; name: string; phone: string }>)
      .map((r) => ({ id: r.id, name: r.name, phone: r.phone, distanceKm: null }));
  });

export type DispatchConfig = {
  broadcastRadiusKm: number;
  broadcastTimeoutSeconds: number;
};

export const getDispatchConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DispatchConfig> => {
    await assertActiveStaff(context);
    const { data, error } = await context.supabase
      .from("dispatch_config")
      .select("broadcast_radius_km, broadcast_timeout_seconds")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      broadcastRadiusKm: Number(data?.broadcast_radius_km ?? 5),
      broadcastTimeoutSeconds: Number(data?.broadcast_timeout_seconds ?? 90),
    };
  });

export const countEligibleExperts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ count: number }> => {
    await assertActiveStaff(context);
    const { data: rows, error } = await context.supabase.rpc(
      "get_eligible_experts_for_booking",
      { p_booking_id: data.bookingId },
    );
    if (error) throw new Error(error.message);
    return { count: (rows ?? []).length };
  });

export const resolveZoneForBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lat: number; lng: number }) => {
    const lat = Number(input?.lat);
    const lng = Number(input?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("lat/lng required");
    }
    return { lat, lng };
  })
  .handler(async ({ data, context }): Promise<{ zoneId: string | null }> => {
    await assertActiveStaff(context);
    const { data: zoneId, error } = await context.supabase.rpc(
      "resolve_zone_for_point",
      { _lat: data.lat, _lng: data.lng },
    );
    if (error) throw new Error(error.message);
    return { zoneId: (zoneId as string | null) ?? null };
  });


export const assignExpertToBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; expertId: string }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    if (!input?.expertId) throw new Error("expertId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_assign_expert", {
      _booking_id: data.bookingId,
      _expert_id: data.expertId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type PipelineStatus =
  | "confirmed"
  | "accepted"
  | "expert_assigned"
  | "in_progress"
  | "completed";

export type PipelineBooking = {
  id: string;
  status: PipelineStatus;
  customerName: string;
  serviceLabel: string | null;
  serviceDurationMinutes: number | null;
  price: number | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  assignedExpertName: string | null;
  createdAt: string;
  updatedAt: string;
};

export const listPipelineBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineBooking[]> => {
    await assertActiveStaff(context);
    const db = context.supabase;

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();

    // Fetch open pipeline (confirmed/accepted/expert_assigned/in_progress)
    // plus today's completed bookings.
    const [openRes, completedRes] = await Promise.all([
      db
        .from("bookings")
        .select(
          "id, status, user_id, assigned_expert_id, service_label, service_duration_minutes, price, scheduled_date, scheduled_time_slot, created_at, updated_at",
        )
        .in("status", [
          "confirmed",
          "accepted",
          "expert_assigned",
          "in_progress",
        ])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("bookings")
        .select(
          "id, status, user_id, assigned_expert_id, service_label, service_duration_minutes, price, scheduled_date, scheduled_time_slot, created_at, updated_at",
        )
        .eq("status", "completed")
        .is("deleted_at", null)
        .gte("created_at", startOfDay)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (openRes.error) throw new Error(openRes.error.message);
    if (completedRes.error) throw new Error(completedRes.error.message);

    const rows = [...(openRes.data ?? []), ...(completedRes.data ?? [])];
    if (rows.length === 0) return [];

    const userIds = Array.from(
      new Set(
        rows.map((r) => r.user_id).filter((id): id is string => !!id),
      ),
    );
    const expertIds = Array.from(
      new Set(
        rows
          .map((r) => r.assigned_expert_id)
          .filter((id): id is string => !!id),
      ),
    );

    const [usersRes, expertsRes] = await Promise.all([
      userIds.length
        ? db.from("users").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null } as const),
      expertIds.length
        ? db.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if ("error" in usersRes && usersRes.error) {
      throw new Error(usersRes.error.message);
    }
    if ("error" in expertsRes && expertsRes.error) {
      throw new Error(expertsRes.error.message);
    }

    const userMap = new Map(
      ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
        .map((u) => [u.id, u.full_name]),
    );
    const expertMap = new Map(
      ((expertsRes.data ?? []) as Array<{ id: string; name: string }>)
        .map((e) => [e.id, e.name]),
    );

    return rows.map((r) => ({
      id: r.id as string,
      status: r.status as PipelineStatus,
      customerName:
        (userMap.get(r.user_id as string) as string | null) ?? "Customer",
      serviceLabel: (r.service_label as string | null) ?? null,
      serviceDurationMinutes:
        (r.service_duration_minutes as number | null) ?? null,
      price: r.price != null ? Number(r.price) : null,
      scheduledDate: (r.scheduled_date as string | null) ?? null,
      scheduledTimeSlot: (r.scheduled_time_slot as string | null) ?? null,
      assignedExpertName: r.assigned_expert_id
        ? (expertMap.get(r.assigned_expert_id as string) as string | null) ??
          null
        : null,
      createdAt: r.created_at as string,
    }));
  });

