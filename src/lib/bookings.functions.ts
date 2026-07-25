import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BookingStatus =
  | "confirmed"
  | "accepted"
  | "expert_assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "rejected";

export const BOOKING_STATUSES: BookingStatus[] = [
  "confirmed",
  "accepted",
  "expert_assigned",
  "in_progress",
  "completed",
  "cancelled",
  "rejected",
];


export type BookingRow = {
  id: string;
  customerName: string;
  serviceLabel: string | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  zoneId: string | null;
  zoneName: string | null;
  assignedExpertId: string | null;
  assignedExpertName: string | null;
  status: BookingStatus;
  paid: boolean;
  createdAt: string;
  deletedAt: string | null;
};

export type ListBookingsInput = {
  status?: string | null;
  zoneId?: string | null;
  from?: string | null; // ISO date (yyyy-mm-dd)
  to?: string | null;
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
};

export type ListBookingsResult = {
  rows: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
};


const sel = (s: string): string => s;

export const listBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ListBookingsInput | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<ListBookingsResult> => {
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    const page = Math.max(1, Math.floor(data.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(data.pageSize ?? 25)));
    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = context.supabase
      .from("bookings")
      .select(
        sel(
          "id, service_label, scheduled_date, scheduled_time_slot, status, razorpay_payment_id, created_at, zone_id, assigned_expert_id, user_id, deleted_at",
        ),
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(fromIdx, toIdx);

    if (!(data.includeDeleted && staff.role === "super_admin")) {
      q = q.is("deleted_at", null);
    }




    if (staff.role === "area_partner") {
      if (!staff.zone_id) {
        return { rows: [], total: 0, page, pageSize };
      }
      q = q.eq("zone_id", staff.zone_id);
    } else if (data.zoneId) {
      q = q.eq("zone_id", data.zoneId);
    }

    if (data.status && BOOKING_STATUSES.includes(data.status as BookingStatus)) {
      q = q.eq("status", data.status);
    }
    if (data.from) q = q.gte("created_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("created_at", `${data.to}T23:59:59Z`);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];
    const userIds = Array.from(new Set(raw.map((r) => r.user_id).filter(Boolean)));
    const zoneIds = Array.from(new Set(raw.map((r) => r.zone_id).filter(Boolean)));
    const expertIds = Array.from(
      new Set(raw.map((r) => r.assigned_expert_id).filter(Boolean)),
    );

    const [usersRes, zonesRes, expertsRes] = await Promise.all([
      userIds.length
        ? context.supabase.from("users").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      zoneIds.length
        ? context.supabase.from("zones").select("id, name").in("id", zoneIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      expertIds.length
        ? context.supabase.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const userMap = new Map(
      ((usersRes.data ?? []) as { id: string; full_name: string | null }[]).map(
        (u) => [u.id, u.full_name ?? "—"],
      ),
    );
    const zoneMap = new Map(
      ((zonesRes.data ?? []) as { id: string; name: string }[]).map((z) => [
        z.id,
        z.name,
      ]),
    );
    const expertMap = new Map(
      ((expertsRes.data ?? []) as { id: string; name: string }[]).map((e) => [
        e.id,
        e.name,
      ]),
    );

    const out: BookingRow[] = raw.map((r) => ({
      id: r.id,
      customerName: userMap.get(r.user_id) ?? "—",
      serviceLabel: r.service_label ?? null,
      scheduledDate: r.scheduled_date ?? null,
      scheduledTimeSlot: r.scheduled_time_slot ?? null,
      zoneId: r.zone_id ?? null,
      zoneName: r.zone_id ? zoneMap.get(r.zone_id) ?? null : null,
      assignedExpertId: r.assigned_expert_id ?? null,
      assignedExpertName: r.assigned_expert_id
        ? expertMap.get(r.assigned_expert_id) ?? null
        : null,
      status: r.status as BookingStatus,
      paid: !!r.razorpay_payment_id,
      createdAt: r.created_at,
      deletedAt: r.deleted_at ?? null,

    }));

    return { rows: out, total: count ?? out.length, page, pageSize };
  });

export type ZoneOption = { id: string; name: string };

export const listZoneOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZoneOption[]> => {
    const { data: staff } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = context.supabase
      .from("zones")
      .select("id, name")
      .eq("status", "active")
      .order("name");
    if (staff.role === "area_partner") {
      if (!staff.zone_id) return [];
      q = q.eq("id", staff.zone_id);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as ZoneOption[]);
  });

export type BookingDetails = {
  id: string;
  status: BookingStatus;
  serviceLabel: string | null;
  serviceDurationMinutes: number | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  slotType: string | null;
  price: number | null;
  paid: boolean;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  createdAt: string;
  updatedAt: string | null;
  rating: number | null;
  reviewText: string | null;
  customer: { id: string | null; name: string | null; phone: string | null };
  address: {
    label: string | null;
    fullAddress: string | null;
    area: string | null;
    city: string | null;
  } | null;
  zone: { id: string | null; name: string | null };
  expert: { id: string | null; name: string | null; phone: string | null };
  cancellationReason: string | null;
  addressId: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
};

async function loadBookingDetails(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bookingId: string,
  role: string,
  staffZoneId: string | null,
): Promise<BookingDetails> {
  const { data: b, error } = await supabase
    .from("bookings")
    .select(
      "id, user_id, address_id, service_label, service_duration_minutes, slot_type, scheduled_date, scheduled_time_slot, status, price, razorpay_order_id, razorpay_payment_id, created_at, updated_at, rating, review_text, assigned_expert_id, zone_id, cancellation_reason, deleted_at, deleted_by, delete_reason",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!b) throw new Error("Booking not found");
  if (role === "area_partner" && (!staffZoneId || b.zone_id !== staffZoneId)) {
    throw new Error("Forbidden");
  }

  const [userRes, addrRes, zoneRes, expertRes] = await Promise.all([
    b.user_id
      ? supabase.from("users").select("id, full_name, phone").eq("id", b.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    b.address_id
      ? supabase
          .from("addresses")
          .select("label, full_address, area, city")
          .eq("id", b.address_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    b.zone_id
      ? supabase.from("zones").select("id, name").eq("id", b.zone_id).maybeSingle()
      : Promise.resolve({ data: null }),
    b.assigned_expert_id
      ? supabase
          .from("experts")
          .select("id, name, phone")
          .eq("id", b.assigned_expert_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id: b.id,
    status: b.status as BookingStatus,
    serviceLabel: b.service_label ?? null,
    serviceDurationMinutes: b.service_duration_minutes ?? null,
    scheduledDate: b.scheduled_date ?? null,
    scheduledTimeSlot: b.scheduled_time_slot ?? null,
    slotType: b.slot_type ?? null,
    price: b.price != null ? Number(b.price) : null,
    paid: !!b.razorpay_payment_id,
    razorpayPaymentId: b.razorpay_payment_id ?? null,
    razorpayOrderId: b.razorpay_order_id ?? null,
    createdAt: b.created_at,
    updatedAt: b.updated_at ?? null,
    rating: b.rating ?? null,
    reviewText: b.review_text ?? null,
    customer: {
      id: userRes.data?.id ?? null,
      name: userRes.data?.full_name ?? null,
      phone: userRes.data?.phone ?? null,
    },
    address: addrRes.data
      ? {
          label: addrRes.data.label ?? null,
          fullAddress: addrRes.data.full_address ?? null,
          area: addrRes.data.area ?? null,
          city: addrRes.data.city ?? null,
        }
      : null,
    zone: { id: zoneRes.data?.id ?? null, name: zoneRes.data?.name ?? null },
    expert: {
      id: expertRes.data?.id ?? null,
      name: expertRes.data?.name ?? null,
      phone: expertRes.data?.phone ?? null,
    },
    cancellationReason: b.cancellation_reason ?? null,
  };
}

export const getBookingDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<BookingDetails> => {
    const { data: staff } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!staff || staff.status !== "active") throw new Error("Forbidden");
    return loadBookingDetails(context.supabase, data.bookingId, staff.role, staff.zone_id ?? null);
  });

export const updateBookingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { bookingId: string; newStatus: BookingStatus; note?: string | null }) => {
      if (!input?.bookingId) throw new Error("bookingId required");
      if (!BOOKING_STATUSES.includes(input.newStatus)) throw new Error("Invalid status");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_booking_status", {
      _booking_id: data.bookingId,
      _new_status: data.newStatus,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const CANCELLATION_REASONS = [
  "SAFETY",
  "FRAUD",
  "DUPLICATE",
  "MANUAL_OVERRIDE",
  "OTHER",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const cancelBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; reason: CancellationReason }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    if (!CANCELLATION_REASONS.includes(input.reason)) throw new Error("Invalid reason");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_cancel_booking", {
      _booking_id: data.bookingId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reassignExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string; newExpertId: string }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    if (!input?.newExpertId) throw new Error("newExpertId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_reassign_expert", {
      _booking_id: data.bookingId,
      _new_expert_id: data.newExpertId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// NOTE: `expert_assigned` is intentionally omitted from the `accepted`
// transitions — assigning an expert happens through the dedicated
// staff_assign_expert RPC (which sets status atomically), never as a raw
// status change.
export const STAFF_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  confirmed: ["accepted", "rejected", "cancelled"],
  accepted: ["cancelled", "rejected"],
  expert_assigned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  rejected: [],
};



