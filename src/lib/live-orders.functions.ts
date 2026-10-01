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
  noExpertTimeoutMinutes: number;
};

export const getDispatchConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DispatchConfig> => {
    await assertActiveStaff(context);
    const { data, error } = await context.supabase
      .from("dispatch_config")
      .select(
        "broadcast_radius_km, broadcast_timeout_seconds, no_expert_timeout_minutes",
      )
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (data ?? null) as any;
    return {
      broadcastRadiusKm: Number(row?.broadcast_radius_km ?? 5),
      broadcastTimeoutSeconds: Number(row?.broadcast_timeout_seconds ?? 90),
      noExpertTimeoutMinutes: Number(row?.no_expert_timeout_minutes ?? 30),
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
  gstAmount: number;
  totalAmount: number;
  discountAmount: number;
  paid: boolean;
  pricingType: "duration" | "flat" | "quantity" | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  slotType: string | null;
  assignedExpertName: string | null;
  assignedExpertId: string | null;
  expertAssignedAt: string | null;
  onTheWayAt: string | null;
  arrivedAt: string | null;
  onwayAlertSent: boolean;
  noExpertAlertSent: boolean;
  createdAt: string;
  updatedAt: string;
  broadcastStartedAt: string | null;
  dispatchExhaustedAt: string | null;
};

/** Timing rules Live Ops needs to decide when a card is late. */
export type BookingJourneyConfig = {
  journeyStepsEnabled: boolean;
  asapOnwayDeadlineMinutes: number;
  scheduledOnwayDeadlineBeforeSlotMinutes: number;
  noExpertAlertBeforeSlotMinutes: number;
  noExpertRefundAfterSlotMinutes: number;
};

export const getBookingJourneyConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BookingJourneyConfig> => {
    await assertActiveStaff(context);
    const { data, error } = await context.supabase
      .from("ops_settings")
      .select("key, value")
      .in("key", [
        "expert_journey_steps_enabled",
        "asap_onway_deadline_minutes",
        "scheduled_onway_deadline_before_slot_minutes",
        "no_expert_alert_before_slot_minutes",
        "no_expert_refund_after_slot_minutes",
      ]);
    if (error) throw new Error(error.message);
    const m = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data ?? []) as any[]).map((r) => [r.key as string, String(r.value ?? "")]),
    );
    const num = (key: string, fallback: number) => {
      const n = Number(m.get(key));
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      journeyStepsEnabled: m.get("expert_journey_steps_enabled") === "1",
      asapOnwayDeadlineMinutes: num("asap_onway_deadline_minutes", 3),
      scheduledOnwayDeadlineBeforeSlotMinutes: num(
        "scheduled_onway_deadline_before_slot_minutes",
        15,
      ),
      noExpertAlertBeforeSlotMinutes: num("no_expert_alert_before_slot_minutes", 5),
      noExpertRefundAfterSlotMinutes: num("no_expert_refund_after_slot_minutes", 30),
    };
  });


export const listPipelineBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { segmentId?: string | null }) => ({
    segmentId: input?.segmentId ?? null,
  }))
  .handler(async ({ data, context }): Promise<PipelineBooking[]> => {
    await assertActiveStaff(context);
    const db = context.supabase;

    let categoryIds: string[] | null = null;
    if (data.segmentId) {
      const { data: cats, error } = await db
        .from("service_categories")
        .select("id")
        .eq("segment_id", data.segmentId);
      if (error) throw new Error(error.message);
      categoryIds = (cats ?? []).map((c) => c.id as string);
      if (categoryIds.length === 0) return [];
    }


    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();

    // Fetch open pipeline (confirmed/accepted/expert_assigned/in_progress)
    // plus today's completed bookings.
    const cols =
      "id, status, user_id, assigned_expert_id, service_label, service_duration_minutes, price, gst_amount, total_amount, discount_amount, razorpay_payment_id, price_option_id, scheduled_date, scheduled_time_slot, slot_type, created_at, updated_at, broadcast_started_at, dispatch_exhausted_at, expert_assigned_at, on_the_way_at, arrived_at, onway_alert_sent, no_expert_alert_sent";
    let openQ = db
      .from("bookings")
      .select(cols)
      .in("status", [
        "confirmed",
        "accepted",
        "expert_assigned",
        "on_the_way",
        "arrived",
        "in_progress",
      ])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    let completedQ = db
      .from("bookings")
      .select(cols)
      .eq("status", "completed")
      .is("deleted_at", null)
      .gte("created_at", startOfDay)
      .order("created_at", { ascending: false })
      .limit(200);
    if (categoryIds) {
      openQ = openQ.in("service_category_id", categoryIds);
      completedQ = completedQ.in("service_category_id", categoryIds);
    }
    const [openRes, completedRes] = await Promise.all([openQ, completedQ]);

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
    const priceOptionIds = Array.from(
      new Set(
        rows
          .map((r) => r.price_option_id)
          .filter((id): id is string => !!id),
      ),
    );

    const [usersRes, expertsRes, priceOptionsRes] = await Promise.all([
      userIds.length
        ? db.from("users").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null } as const),
      expertIds.length
        ? db.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [], error: null } as const),
      priceOptionIds.length
        ? db
            .from("service_price_options")
            .select("id, services(pricing_type)")
            .in("id", priceOptionIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if ("error" in usersRes && usersRes.error) {
      throw new Error(usersRes.error.message);
    }
    if ("error" in expertsRes && expertsRes.error) {
      throw new Error(expertsRes.error.message);
    }
    if ("error" in priceOptionsRes && priceOptionsRes.error) {
      throw new Error(priceOptionsRes.error.message);
    }

    const userMap = new Map(
      ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null }>)
        .map((u) => [u.id, u.full_name]),
    );
    const expertMap = new Map(
      ((expertsRes.data ?? []) as Array<{ id: string; name: string }>)
        .map((e) => [e.id, e.name]),
    );
    const pricingTypeMap = new Map(
      ((priceOptionsRes.data ?? []) as Array<{
        id: string;
        services: { pricing_type: "duration" | "flat" | "quantity" } | Array<{ pricing_type: "duration" | "flat" | "quantity" }> | null;
      }>).map((option) => {
        const service = Array.isArray(option.services) ? option.services[0] : option.services;
        return [option.id, service?.pricing_type ?? null] as const;
      }),
    );

    return rows.map((r) => ({
      id: r.id as string,
      // `on_the_way` / `arrived` are journey steps after assignment — they stay
      // in the "Expert Assigned" column and surface as badges on the card.
      status: (r.status === "on_the_way" || r.status === "arrived"
        ? "expert_assigned"
        : r.status) as PipelineStatus,
      customerName:
        (userMap.get(r.user_id as string) as string | null) ?? "Customer",
      serviceLabel: (r.service_label as string | null) ?? null,
      serviceDurationMinutes:
        (r.service_duration_minutes as number | null) ?? null,
      price: r.price != null ? Number(r.price) : null,
      gstAmount: Number(r.gst_amount ?? 0),
      totalAmount: Number(r.total_amount ?? 0),
      discountAmount: Number(r.discount_amount ?? 0),
      paid: Boolean(r.razorpay_payment_id),
      pricingType: r.price_option_id
        ? (pricingTypeMap.get(r.price_option_id as string) ?? null)
        : null,
      scheduledDate: (r.scheduled_date as string | null) ?? null,
      scheduledTimeSlot: (r.scheduled_time_slot as string | null) ?? null,
      slotType: ((r as Record<string, unknown>)["slot_type"] as string | null) ?? null,
      assignedExpertName: r.assigned_expert_id
        ? (expertMap.get(r.assigned_expert_id as string) as string | null) ??
          null
        : null,
      assignedExpertId: (r.assigned_expert_id as string | null) ?? null,
      expertAssignedAt:
        ((r as Record<string, unknown>)["expert_assigned_at"] as string | null) ?? null,
      onTheWayAt:
        ((r as Record<string, unknown>)["on_the_way_at"] as string | null) ?? null,
      arrivedAt: ((r as Record<string, unknown>)["arrived_at"] as string | null) ?? null,
      onwayAlertSent: Boolean((r as Record<string, unknown>)["onway_alert_sent"]),
      noExpertAlertSent: Boolean((r as Record<string, unknown>)["no_expert_alert_sent"]),
      createdAt: r.created_at as string,
      updatedAt: (r.updated_at as string | null) ?? (r.created_at as string),
      broadcastStartedAt:
        ((r as Record<string, unknown>)["broadcast_started_at"] as
          | string
          | null) ?? null,
      dispatchExhaustedAt:
        ((r as Record<string, unknown>)["dispatch_exhausted_at"] as
          | string
          | null) ?? null,


    }));
  });

