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
  customer_segment: "regular" | "corporate";
  extra_pickup_fee: number;
  extra_drop_fee: number;
  max_pickups: number | null;
  max_drops: number | null;
  return_per_km: number;
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
            "id, city, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct, is_placeholder, customer_segment, extra_pickup_fee, extra_drop_fee, max_pickups, max_drops, return_per_km",
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
        customer_segment: (r["customer_segment"] === "corporate" ? "corporate" : "regular") as RateRow["customer_segment"],
        extra_pickup_fee: Number(r["extra_pickup_fee"] ?? 0),
        extra_drop_fee: Number(r["extra_drop_fee"] ?? 0),
        max_pickups: r["max_pickups"] == null ? null : Number(r["max_pickups"]),
        max_drops: r["max_drops"] == null ? null : Number(r["max_drops"]),
        return_per_km: Number(r["return_per_km"] ?? 0),
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
  segment: "regular" | "corporate";
  extraPickupFee: number;
  extraDropFee: number;
  maxPickups: number | null;
  maxDrops: number | null;
  returnPerKm: number;
};

export const saveRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: RateInput) => {
    if (!input?.city?.trim()) throw new Error("City is required");
    if (!input?.vehicleTypeId) throw new Error("Vehicle is required");
    if (input.extraPickupFee < 0 || input.extraDropFee < 0) throw new Error("Stop fees must be 0 or more");
    if (input.returnPerKm < 0) throw new Error("Return charge per km must be 0 or more");
    if (input.segment === "regular" && (!input.maxPickups || !input.maxDrops || input.maxPickups < 1 || input.maxDrops < 1))
      throw new Error("Regular rates need max pickups and max drops of at least 1");
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
      _customer_segment: data.segment,
      _extra_pickup_fee: Number(data.extraPickupFee ?? 0),
      _extra_drop_fee: Number(data.extraDropFee ?? 0),
      _max_pickups: data.maxPickups,
      _max_drops: data.maxDrops,
      _return_per_km: Number(data.returnPerKm ?? 0),
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

/* ------------------------------ Zone mapping ------------------------------ */

export type CourierZoneRow = {
  id: string;
  name: string;
  city: string;
  mapped: boolean;
};

export type CourierZoneMapping = {
  cities: string[];
  zones: CourierZoneRow[];
};

export const listCourierZoneMapping = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CourierZoneMapping> => {
    await requireCourierStaff(context);
    const db = context.supabase;

    const [{ data: zoneRows, error: zErr }, { data: mapRows, error: mErr }, { data: flagRows }] =
      await Promise.all([
        db
          .from("zones")
          .select("id, name, city")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("city", { ascending: true })
          .order("name", { ascending: true }),
        db.from("courier_zones").select("zone_id, is_active"),
        db.from("service_flags").select("city").eq("service_key", "courier"),
      ]);
    if (zErr) throw new Error(zErr.message);
    if (mErr) throw new Error(mErr.message);

    const active = new Set(
      ((mapRows ?? []) as Array<{ zone_id: string; is_active: boolean }>)
        .filter((r) => r.is_active)
        .map((r) => r.zone_id),
    );

    const zones = ((zoneRows ?? []) as Array<{ id: string; name: string; city: string | null }>).map(
      (z) => ({
        id: z.id,
        name: z.name,
        city: (z.city ?? "").trim(),
        mapped: active.has(z.id),
      }),
    );

    const cities = new Set<string>();
    for (const r of (flagRows ?? []) as Array<{ city: string | null }>) {
      const c = (r.city ?? "").trim();
      if (c) cities.add(c);
    }
    for (const z of zones) if (z.city) cities.add(z.city);

    return { cities: [...cities].sort((a, b) => a.localeCompare(b)), zones };
  });

export const saveCourierZoneMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { city: string; zoneIds: string[] }) => {
    if (!input?.city?.trim()) throw new Error("City is required");
    return { city: input.city.trim(), zoneIds: Array.isArray(input.zoneIds) ? input.zoneIds : [] };
  })
  .handler(async ({ data, context }) => {
    await requireCourierWriter(context);
    const { error } = await rpc(context.supabase, "staff_courier_set_zones", {
      _city: data.city,
      _zone_ids: data.zoneIds,
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
  pickup_count: number;
  drop_count: number;
  returnPaymentPending: boolean;
  stopsFee: number;
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
  .inputValidator(
    (input?: { status?: string | null; search?: string | null; multiStop?: boolean }) => ({
      status: input?.status ?? null,
      search: input?.search?.trim() || null,
      multiStop: !!input?.multiStop,
    }),
  )
  .handler(async ({ data, context }): Promise<CourierOrderRow[]> => {
    await requireCourierStaff(context);
    const db = context.supabase;

    let q = db
      .from("courier_orders")
      .select(
        "id, order_code, city, status, total_amount, payment_status, refund_status, needs_ops_attention, incident_code, incident_resolution, pickup_address, drop_address, customer_id, assigned_expert_id, created_at, pickup_count, drop_count, fare_breakdown",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) q = q.ilike("order_code", `%${data.search}%`);
    if (data.multiStop) q = q.or("pickup_count.gt.1,drop_count.gt.1");

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

    const orderIds = list.map((r) => r["id"] as string);
    const [uRes, eRes, cRes] = await Promise.all([
      customerIds.length
        ? db.from("users").select("id, full_name").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      expertIds.length
        ? db.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [], error: null }),
      db.from("courier_order_charges").select("order_id").eq("status", "pending").in("order_id", orderIds),
    ]);
    const pendingSet = new Set(
      ((cRes.data ?? []) as Array<{ order_id: string }>).map((c) => c.order_id),
    );
    const stopsFeeOf = (fb: unknown) => {
      if (!fb || typeof fb !== "object") return 0;
      const o = fb as Record<string, unknown>;
      const direct = Number(o["stops_fee"] ?? NaN);
      if (Number.isFinite(direct)) return direct;
      return Number(o["extra_pickup_fee"] ?? 0) + Number(o["extra_drop_fee"] ?? 0);
    };
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
      pickup_count: Number(r["pickup_count"] ?? 1),
      drop_count: Number(r["drop_count"] ?? 1),
      returnPaymentPending: pendingSet.has(r["id"] as string),
      stopsFee: stopsFeeOf(r["fare_breakdown"]),
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

/* --------------------------- Multi-stop details --------------------------- */

export type CourierStopRow = {
  id: string;
  stop_type: string;
  sequence: number;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string;
  arrived_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  fail_reason_code: string | null;
};
export type CourierParcelRow = {
  id: string;
  pickup_stop_id: string | null;
  drop_stop_id: string | null;
  return_stop_id: string | null;
  description: string | null;
  status: string;
};
export type CourierChargeRow = {
  id: string;
  parcel_id: string | null;
  charge_type: string;
  distance_km: number;
  amount: number;
  gst_amount: number;
  total_amount: number;
  status: string;
  paid_at: string | null;
  razorpay_payment_id: string | null;
};

export const getCourierOrderStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ stops: CourierStopRow[]; parcels: CourierParcelRow[]; charges: CourierChargeRow[] }> => {
      await requireCourierStaff(context);
      const db = context.supabase;
      const [s, p, c] = await Promise.all([
        db
          .from("courier_order_stops")
          .select(
            "id, stop_type, sequence, address, contact_name, contact_phone, status, arrived_at, completed_at, failed_at, fail_reason_code",
          )
          .eq("order_id", data.orderId)
          .order("sequence", { ascending: true }),
        db
          .from("courier_order_parcels")
          .select("id, pickup_stop_id, drop_stop_id, return_stop_id, description, status")
          .eq("order_id", data.orderId)
          .order("created_at", { ascending: true }),
        db
          .from("courier_order_charges")
          .select(
            "id, parcel_id, charge_type, distance_km, amount, gst_amount, total_amount, status, paid_at, razorpay_payment_id",
          )
          .eq("order_id", data.orderId)
          .order("created_at", { ascending: true }),
      ]);
      if (s.error) throw new Error(s.error.message);
      if (p.error) throw new Error(p.error.message);
      if (c.error) throw new Error(c.error.message);
      return {
        stops: (s.data ?? []) as CourierStopRow[],
        parcels: (p.data ?? []) as CourierParcelRow[],
        charges: ((c.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          ...(r as unknown as CourierChargeRow),
          distance_km: Number(r["distance_km"] ?? 0),
          amount: Number(r["amount"] ?? 0),
          gst_amount: Number(r["gst_amount"] ?? 0),
          total_amount: Number(r["total_amount"] ?? 0),
        })),
      };
    },
  );

export const waiveCourierCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chargeId: string; reason: string }) => {
    if (!input?.chargeId) throw new Error("chargeId required");
    if (!input.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierStaff(context);
    const { error } = await rpc(context.supabase, "staff_courier_waive_charge", {
      _charge_id: data.chargeId,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const verifyCourierStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { stopId: string; reason: string }) => {
    if (!input?.stopId) throw new Error("stopId required");
    if ((input.reason ?? "").trim().length < 10) throw new Error("Reason must be at least 10 characters");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCourierStaff(context);
    const { error } = await rpc(context.supabase, "staff_courier_verify_stop", {
      _stop_id: data.stopId,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const COURIER_SETTING_KEYS = [
  { key: "courier_fail_wait_minutes", label: "Wait before rider can mark a stop failed (minutes)", def: 10 },
  {
    key: "courier_return_payment_escalation_minutes",
    label: "Escalate unpaid return charge after (minutes)",
    def: 15,
  },
] as const;

export const getCourierSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ key: string; label: string; value: number; isDefault: boolean }>> => {
    await requireCourierStaff(context);
    const { data, error } = await context.supabase
      .from("ops_settings")
      .select("key, value")
      .in("key", COURIER_SETTING_KEYS.map((k) => k.key));
    if (error) throw new Error(error.message);
    const m = new Map(((data ?? []) as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
    return COURIER_SETTING_KEYS.map((k) => {
      const raw = m.get(k.key);
      const n = raw != null && raw !== "" ? Number(raw) : NaN;
      return { key: k.key, label: k.label, value: Number.isFinite(n) ? n : k.def, isDefault: !Number.isFinite(n) };
    });
  });

export const saveCourierSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string; value: number }) => {
    if (!COURIER_SETTING_KEYS.some((k) => k.key === input?.key)) throw new Error("Unknown setting");
    const v = Number(input.value);
    if (!Number.isInteger(v) || v < 1 || v > 120) throw new Error("Enter a whole number from 1 to 120");
    return { key: input.key, value: v };
  })
  .handler(async ({ data, context }) => {
    await requireCourierStaff(context);
    const { error } = await rpc(context.supabase, "staff_courier_set_setting", {
      _key: data.key,
      _value: data.value,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
