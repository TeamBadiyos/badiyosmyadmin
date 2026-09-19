import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CourierAccess = {
  role: "super_admin" | "ops_manager";
  canWrite: boolean;
};

type Ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpc(db: any, fn: string, args: Record<string, unknown>) {
  return db.rpc(fn, args) as Promise<{ data: unknown; error: { message: string } | null }>;
}

async function requireCourierStaff(context: Ctx): Promise<CourierAccess> {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  const role = data.role as string;
  if (role !== "super_admin" && role !== "ops_manager") throw new Error("Forbidden");
  return { role: role as CourierAccess["role"], canWrite: role === "super_admin" };
}

async function requireCourierWriter(context: Ctx): Promise<CourierAccess> {
  const access = await requireCourierStaff(context);
  if (!access.canWrite) throw new Error("Only a super admin can change courier settings");
  return access;
}

export const getCourierAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CourierAccess> => requireCourierStaff(context));

/* ------------------------------ Service flags ----------------------------- */

export type ServiceFlagRow = {
  id: string;
  service_key: string;
  city: string;
  label: string | null;
  is_active: boolean;
  sort_order: number;
  activeOrders: number;
};

const OPEN_COURIER_STATUSES = [
  "SEARCHING",
  "ASSIGNED",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED_DELIVERY",
];

const OPEN_BOOKING_STATUSES = ["confirmed", "accepted", "expert_assigned", "in_progress"];

export const listServiceFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceFlagRow[]> => {
    await requireCourierStaff(context);
    const db = context.supabase;

    const { data, error } = await db
      .from("service_flags")
      .select("id, service_key, city, label, is_active, sort_order")
      .order("city", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Omit<ServiceFlagRow, "activeOrders">>;

    const { data: courierRows, error: cErr } = await db
      .from("courier_orders")
      .select("city, status")
      .in("status", OPEN_COURIER_STATUSES)
      .limit(5000);
    if (cErr) throw new Error(cErr.message);

    const courierByCity = new Map<string, number>();
    for (const r of (courierRows ?? []) as Array<{ city: string | null }>) {
      const key = (r.city ?? "").toLowerCase();
      courierByCity.set(key, (courierByCity.get(key) ?? 0) + 1);
    }

    const { count: openBookings, error: bErr } = await db
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .in("status", OPEN_BOOKING_STATUSES)
      .is("deleted_at", null);
    if (bErr) throw new Error(bErr.message);

    return rows.map((r) => ({
      ...r,
      activeOrders:
        r.service_key === "courier"
          ? (courierByCity.get((r.city ?? "").toLowerCase()) ?? 0)
          : (openBookings ?? 0),
    }));
  });

export const setServiceFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { serviceKey: string; city: string; isActive: boolean }) => {
    if (!input?.serviceKey || !input?.city) throw new Error("serviceKey and city required");
    return { ...input, isActive: !!input.isActive };
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_set_service_flag", {
      _service_key: data.serviceKey,
      _city: data.city,
      _is_active: data.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ------------------------------ Vehicle types ----------------------------- */

export type VehicleTypeRow = {
  id: string;
  name: string;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  max_weight_kg: number;
  inclusions: string[];
  exclusions: string[];
  required_skill: string | null;
  required_documents: string[];
};

export type SkillOption = { id: string; name: string };

export const listVehicleTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: VehicleTypeRow[]; skills: SkillOption[] }> => {
    await requireCourierStaff(context);
    const db = context.supabase;
    const [vRes, sRes] = await Promise.all([
      db
        .from("courier_vehicle_types")
        .select(
          "id, name, icon, is_active, sort_order, max_weight_kg, inclusions, exclusions, required_skill, required_documents",
        )
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      db.from("service_categories").select("id, name").order("name", { ascending: true }),
    ]);
    if (vRes.error) throw new Error(vRes.error.message);
    if (sRes.error) throw new Error(sRes.error.message);
    return {
      rows: ((vRes.data ?? []) as VehicleTypeRow[]).map((r) => ({
        ...r,
        max_weight_kg: Number(r.max_weight_kg ?? 0),
        inclusions: r.inclusions ?? [],
        exclusions: r.exclusions ?? [],
        required_documents: r.required_documents ?? [],
      })),
      skills: (sRes.data ?? []) as SkillOption[],
    };
  });

export type VehicleTypeInput = {
  id?: string | null;
  name: string;
  icon?: string | null;
  maxWeightKg: number;
  inclusions: string[];
  exclusions: string[];
  requiredSkill?: string | null;
  requiredDocuments: string[];
  sortOrder: number;
  isActive: boolean;
};

export const saveVehicleType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VehicleTypeInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await rpc(context.supabase, "staff_courier_upsert_vehicle_type", {
      _id: data.id ?? null,
      _name: data.name.trim(),
      _icon: data.icon ?? null,
      _max_weight_kg: Number(data.maxWeightKg ?? 0),
      _inclusions: data.inclusions ?? [],
      _exclusions: data.exclusions ?? [],
      _required_skill: data.requiredSkill || null,
      _required_documents: data.requiredDocuments ?? [],
      _sort_order: Number(data.sortOrder ?? 0),
      _is_active: !!data.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setVehicleTypeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; isActive: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_set_vehicle_type_active", {
      _id: data.id,
      _is_active: !!data.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ---------------------------------- Rates --------------------------------- */

export type RateRow = {
  id: string;
  city: string;
  vehicle_type_id: string;
  vehicleName: string;
  base_fare: number;
  included_km: number;
  per_km: number;
  min_fare: number;
  platform_fee: number;
  commission_pct: number;
  is_placeholder: boolean;
};

export const listRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ rows: RateRow[]; vehicles: Array<{ id: string; name: string }>; cancellationFee: number }> => {
      await requireCourierStaff(context);
      const db = context.supabase;
      const [rRes, vRes, sRes] = await Promise.all([
        db
          .from("courier_vehicle_rates")
          .select(
            "id, city, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct, is_placeholder",
          )
          .order("city", { ascending: true }),
        db.from("courier_vehicle_types").select("id, name").order("sort_order", { ascending: true }),
        db.rpc("courier_setting", { _key: "cancellation_fee", _default: 0 }),
      ]);
      if (rRes.error) throw new Error(rRes.error.message);
      if (vRes.error) throw new Error(vRes.error.message);

      const vehicles = (vRes.data ?? []) as Array<{ id: string; name: string }>;
      const vMap = new Map(vehicles.map((v) => [v.id, v.name]));
      const rows = ((rRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r["id"] as string,
        city: r["city"] as string,
        vehicle_type_id: r["vehicle_type_id"] as string,
        vehicleName: vMap.get(r["vehicle_type_id"] as string) ?? "Unknown vehicle",
        base_fare: Number(r["base_fare"] ?? 0),
        included_km: Number(r["included_km"] ?? 0),
        per_km: Number(r["per_km"] ?? 0),
        min_fare: Number(r["min_fare"] ?? 0),
        platform_fee: Number(r["platform_fee"] ?? 0),
        commission_pct: Number(r["commission_pct"] ?? 0),
        is_placeholder: !!r["is_placeholder"],
      }));
      return { rows, vehicles, cancellationFee: Number(sRes?.data ?? 0) };
    },
  );

export type RateInput = {
  id?: string | null;
  city: string;
  vehicleTypeId: string;
  baseFare: number;
  includedKm: number;
  perKm: number;
  minFare: number;
  platformFee: number;
  commissionPct: number;
};

export const saveRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: RateInput) => {
    if (!input?.city?.trim()) throw new Error("City is required");
    if (!input?.vehicleTypeId) throw new Error("Vehicle is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await rpc(context.supabase, "staff_courier_upsert_rate", {
      _id: data.id ?? null,
      _city: data.city.trim(),
      _vehicle_type_id: data.vehicleTypeId,
      _base_fare: Number(data.baseFare ?? 0),
      _included_km: Number(data.includedKm ?? 0),
      _per_km: Number(data.perKm ?? 0),
      _min_fare: Number(data.minFare ?? 0),
      _platform_fee: Number(data.platformFee ?? 0),
      _commission_pct: Number(data.commissionPct ?? 0),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const confirmRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_confirm_rate", { _id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ----------------------- Courier types + mapping -------------------------- */

export type CourierTypeRow = {
  id: string;
  name: string;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  extra_fee: number;
  instructions: string | null;
};

export type MappingRow = {
  vehicle_type_id: string;
  courier_type_id: string;
  is_active: boolean;
};

export const listCourierTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      rows: CourierTypeRow[];
      vehicles: Array<{ id: string; name: string }>;
      mapping: MappingRow[];
    }> => {
      await requireCourierStaff(context);
      const db = context.supabase;
      const [tRes, vRes, mRes] = await Promise.all([
        db
          .from("courier_types")
          .select("id, name, icon, is_active, sort_order, extra_fee, instructions")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        db.from("courier_vehicle_types").select("id, name").order("sort_order", { ascending: true }),
        db.from("courier_vehicle_courier_types").select("vehicle_type_id, courier_type_id, is_active"),
      ]);
      if (tRes.error) throw new Error(tRes.error.message);
      if (vRes.error) throw new Error(vRes.error.message);
      if (mRes.error) throw new Error(mRes.error.message);
      return {
        rows: ((tRes.data ?? []) as CourierTypeRow[]).map((r) => ({
          ...r,
          extra_fee: Number(r.extra_fee ?? 0),
        })),
        vehicles: (vRes.data ?? []) as Array<{ id: string; name: string }>,
        mapping: (mRes.data ?? []) as MappingRow[],
      };
    },
  );

export type CourierTypeInput = {
  id?: string | null;
  name: string;
  icon?: string | null;
  extraFee: number;
  instructions?: string | null;
  sortOrder: number;
  isActive: boolean;
};

export const saveCourierType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CourierTypeInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await rpc(context.supabase, "staff_courier_upsert_courier_type", {
      _id: data.id ?? null,
      _name: data.name.trim(),
      _icon: data.icon ?? null,
      _extra_fee: Number(data.extraFee ?? 0),
      _instructions: data.instructions ?? null,
      _sort_order: Number(data.sortOrder ?? 0),
      _is_active: !!data.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setCourierTypeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; isActive: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_set_courier_type_active", {
      _id: data.id,
      _is_active: !!data.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setVehicleCourierType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { vehicleTypeId: string; courierTypeId: string; isActive: boolean }) => {
    if (!input?.vehicleTypeId || !input?.courierTypeId) throw new Error("ids required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_set_vehicle_courier_type", {
      _vehicle_type_id: data.vehicleTypeId,
      _courier_type_id: data.courierTypeId,
      _is_active: !!data.isActive,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* -------------------------------- Orders ---------------------------------- */

export type CourierOrderRow = {
  id: string;
  order_code: string;
  city: string | null;
  status: string;
  total_amount: number;
  payment_status: string | null;
  refund_status: string | null;
  needs_ops_attention: boolean;
  incident_code: string | null;
  incident_resolution: string | null;
  pickup_address: string | null;
  drop_address: string | null;
  customerName: string | null;
  riderName: string | null;
  assigned_expert_id: string | null;
  created_at: string;
};

export const COURIER_STATUSES = [
  "QUOTED",
  "PAID",
  "SEARCHING",
  "ASSIGNED",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "FAILED_DELIVERY",
  "CANCELLED",
] as const;

export const listCourierOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: string | null; search?: string | null }) => ({
    status: input?.status ?? null,
    search: input?.search?.trim() || null,
  }))
  .handler(async ({ data, context }): Promise<CourierOrderRow[]> => {
    await requireCourierStaff(context);
    const db = context.supabase;

    let q = db
      .from("courier_orders")
      .select(
        "id, order_code, city, status, total_amount, payment_status, refund_status, needs_ops_attention, incident_code, incident_resolution, pickup_address, drop_address, customer_id, assigned_expert_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) q = q.ilike("order_code", `%${data.search}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    if (list.length === 0) return [];

    const customerIds = Array.from(
      new Set(list.map((r) => r["customer_id"]).filter(Boolean) as string[]),
    );
    const expertIds = Array.from(
      new Set(list.map((r) => r["assigned_expert_id"]).filter(Boolean) as string[]),
    );

    const [uRes, eRes] = await Promise.all([
      customerIds.length
        ? db.from("users").select("id, full_name").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      expertIds.length
        ? db.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const uMap = new Map(
      ((uRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => [
        u.id,
        u.full_name,
      ]),
    );
    const eMap = new Map(
      ((eRes.data ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
    );

    return list.map((r) => ({
      id: r["id"] as string,
      order_code: r["order_code"] as string,
      city: (r["city"] as string | null) ?? null,
      status: r["status"] as string,
      total_amount: Number(r["total_amount"] ?? 0),
      payment_status: (r["payment_status"] as string | null) ?? null,
      refund_status: (r["refund_status"] as string | null) ?? null,
      needs_ops_attention: !!r["needs_ops_attention"],
      incident_code: (r["incident_code"] as string | null) ?? null,
      incident_resolution: (r["incident_resolution"] as string | null) ?? null,
      pickup_address: (r["pickup_address"] as string | null) ?? null,
      drop_address: (r["drop_address"] as string | null) ?? null,
      customerName: r["customer_id"] ? (uMap.get(r["customer_id"] as string) ?? null) : null,
      riderName: r["assigned_expert_id"]
        ? (eMap.get(r["assigned_expert_id"] as string) ?? null)
        : null,
      assigned_expert_id: (r["assigned_expert_id"] as string | null) ?? null,
      created_at: r["created_at"] as string,
    }));
  });

export type CourierEventRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_type: string | null;
  created_at: string;
  metaText: string;
};

export const listCourierOrderEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<CourierEventRow[]> => {
    await requireCourierStaff(context);
    const { data: rows, error } = await context.supabase
      .from("courier_order_events")
      .select("id, from_status, to_status, actor_type, created_at, meta")
      .eq("order_id", data.orderId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string,
      from_status: (r["from_status"] as string | null) ?? null,
      to_status: r["to_status"] as string,
      actor_type: (r["actor_type"] as string | null) ?? null,
      created_at: r["created_at"] as string,
      metaText: r["meta"] ? JSON.stringify(r["meta"]) : "",
    }));
  });

export const listCourierRiders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ id: string; name: string; phone: string }>> => {
    await requireCourierStaff(context);
    const { data, error } = await context.supabase
      .from("experts")
      .select("id, name, phone")
      .eq("status", "active")
      .order("name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ id: string; name: string; phone: string }>;
  });

export const reassignRider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; expertId: string }) => {
    if (!input?.orderId || !input?.expertId) throw new Error("orderId and expertId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_reassign_rider", {
      _order_id: data.orderId,
      _expert_id: data.expertId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const forceCancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; reason: string; refundAmount: number }) => {
    if (!input?.orderId) throw new Error("orderId required");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_force_cancel", {
      _order_id: data.orderId,
      _reason: data.reason.trim(),
      _refund_amount: Number(data.refundAmount ?? 0),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const refundOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; amount: number; reason: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    if (!(Number(input.amount) > 0)) throw new Error("Refund amount must be greater than zero");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_refund", {
      _order_id: data.orderId,
      _amount: Number(data.amount),
      _reason: data.reason?.trim() || "staff_refund",
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const resolveIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      orderId: string;
      resolution: "full_refund" | "partial_refund" | "no_refund";
      refundAmount: number;
      payRider: boolean;
    }) => {
      if (!input?.orderId) throw new Error("orderId required");
      if (!["full_refund", "partial_refund", "no_refund"].includes(input.resolution)) {
        throw new Error("Invalid resolution");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await context.supabase.rpc("staff_courier_resolve_incident", {
      _order_id: data.orderId,
      _resolution: data.resolution,
      _refund_amount: data.resolution === "no_refund" ? 0 : Number(data.refundAmount ?? 0),
      _pay_rider: !!data.payRider,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
