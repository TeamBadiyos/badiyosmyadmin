import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = { supabase: any; userId: string };

async function requireOps(context: Ctx) {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role))
    throw new Error("Forbidden");
  return { role: data.role as string, canWrite: data.role === "super_admin", canOperate: true };
}

async function requireSuper(context: Ctx) {
  const a = await requireOps(context);
  if (!a.canWrite) throw new Error("Only a super admin can do this");
}

async function rpc(context: Ctx, name: string, args: Record<string, unknown>) {
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export type PricingPlan = {
  id: string; name: string; base_fare: number; included_km: number; per_km: number;
  min_fare: number; extra_drop_fee: number; return_per_km: number; commission_pct: number;
  cancel_fee_type: "percentage" | "fixed"; cancel_fee_value: number;
  drop_count_basis: "packet" | "shop";
  is_active: boolean; used_by: number;
};
export type DispatchPlan = {
  id: string; name: string; manual_enabled: boolean; qty_enabled: boolean; qty_threshold: number | null;
  slots_enabled: boolean; slot_times: string[]; max_drops_per_batch: number | null;
  time_per_drop_min: number; cost_per_extra_trip: number | null; is_active: boolean; used_by: number;
};

export const getBulkAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => requireOps(context as Ctx));

export const listBulkPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ pricing: PricingPlan[]; dispatch: DispatchPlan[] }> => {
    const d = (await rpc(context as Ctx, "staff_list_bulk_plans", {})) ?? {};
    return {
      pricing: ((d.pricing ?? []) as any[]).map((p) => ({
        ...p,
        base_fare: Number(p.base_fare ?? 0), included_km: Number(p.included_km ?? 0),
        per_km: Number(p.per_km ?? 0), min_fare: Number(p.min_fare ?? 0),
        extra_drop_fee: Number(p.extra_drop_fee ?? 0), return_per_km: Number(p.return_per_km ?? 0),
        commission_pct: Number(p.commission_pct ?? 0), used_by: Number(p.used_by ?? 0),
        cancel_fee_type: ["flat", "fixed"].includes(String(p.cancel_fee_type ?? "").toLowerCase()) ? "fixed" : "percentage",
        cancel_fee_value: p.cancel_fee_value == null ? 50 : Number(p.cancel_fee_value),
        drop_count_basis: p.drop_count_basis === "shop" ? "shop" : "packet",
      })),
      dispatch: ((d.dispatch ?? []) as any[]).map((p) => ({
        ...p,
        slot_times: ((p.slot_times ?? []) as string[]).map((t) => String(t).slice(0, 5)),
        time_per_drop_min: Number(p.time_per_drop_min ?? 3),
        cost_per_extra_trip: p.cost_per_extra_trip == null ? null : Number(p.cost_per_extra_trip),
        used_by: Number(p.used_by ?? 0),
      })),
    };
  });

export const savePricingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Omit<PricingPlan, "used_by" | "id"> & { id: string | null }) => {
    if (!i?.name?.trim()) throw new Error("Name required");
    if (i.cancel_fee_type === "percentage" && (i.cancel_fee_value < 0 || i.cancel_fee_value > 100)) throw new Error("Cancel fee % must be 0-100");
    if (i.cancel_fee_value < 0) throw new Error("Cancel fee cannot be negative");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_upsert_pricing_plan", {
      _id: i.id, _name: i.name.trim(), _base_fare: i.base_fare, _included_km: i.included_km,
      _per_km: i.per_km, _min_fare: i.min_fare, _extra_drop_fee: i.extra_drop_fee,
      _return_per_km: i.return_per_km, _commission_pct: i.commission_pct, _is_active: i.is_active,
      _cancel_fee_type: i.cancel_fee_type === "fixed" ? "flat" : "percent", _cancel_fee_value: i.cancel_fee_value ?? 50,
      _drop_count_basis: i.drop_count_basis === "shop" ? "shop" : "packet",
    });
    return { ok: true };
  });

export const saveDispatchPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Omit<DispatchPlan, "used_by" | "id"> & { id: string | null }) => {
    if (!i?.name?.trim()) throw new Error("Name required");
    if (!i.manual_enabled && !i.qty_enabled && !i.slots_enabled && !i.max_drops_per_batch)
      throw new Error("Tick at least one option");
    const t = Number(i.time_per_drop_min ?? 3);
    if (!Number.isInteger(t) || t < 1 || t > 15) throw new Error("Time per drop must be 1-15 minutes");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_upsert_dispatch_plan", {
      _id: i.id, _name: i.name.trim(), _manual_enabled: i.manual_enabled,
      _qty_enabled: i.qty_enabled, _qty_threshold: i.qty_enabled ? i.qty_threshold : null,
      _slots_enabled: i.slots_enabled, _slot_times: i.slots_enabled ? i.slot_times : [],
      _max_drops_per_batch: i.max_drops_per_batch, _is_active: i.is_active,
      _time_per_drop_min: Number(i.time_per_drop_min ?? 3),
      _cost_per_extra_trip: i.cost_per_extra_trip == null ? null : Number(i.cost_per_extra_trip),
    });
    return { ok: true };
  });

export const setPlanActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "pricing" | "dispatch"; id: string; active: boolean }) => i)
  .handler(async ({ data: i, context }) => {
    const r = await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_set_plan_active", {
      _kind: i.kind, _id: i.id, _active: i.active, _reason: null,
    });
    return { ok: !!r?.ok, reason: (r?.reason as string) ?? null, used_by: Number(r?.used_by ?? 0) };
  });

/* ------------------------------ businesses ------------------------------ */

export type BusinessRow = {
  merchant_id: string; business_name: string; phone: string | null; city: string | null;
  delivery_status: string | null; store_enabled: boolean; delivery_enabled: boolean;
  pricing_plan_id: string | null; dispatch_plan_id: string | null;
  pricing_plan: string | null; dispatch_plan: string | null;
  vehicle_type_id: string | null; courier_type_id: string | null;
  low_balance_threshold: number; wallet_balance: number;
  pending_orders: number; trips_today: number;
  seal_low: boolean;
};

export const listBusinesses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BusinessRow[]> => {
    await requireOps(context as Ctx);
    const db = (context as Ctx).supabase;
    const { data: profs, error } = await db.from("business_profiles").select("*");
    if (error) throw new Error(error.message);
    const list = (profs ?? []) as any[];
    if (!list.length) return [];
    const ids = list.map((p) => p.merchant_id);
    const startIst = new Date(Date.now() + 5.5 * 3600e3);
    startIst.setUTCHours(0, 0, 0, 0);
    const todayStart = new Date(startIst.getTime() - 5.5 * 3600e3).toISOString();
    const [m, pp, dp, ord, bat] = await Promise.all([
      db.from("merchants").select("id, store_name, phone, city, delivery_status, delivery_wallet_balance, store_enabled, delivery_enabled").in("id", ids),
      db.from("bulk_pricing_plans").select("id, name"),
      db.from("bulk_dispatch_plans").select("id, name"),
      db.from("business_orders").select("merchant_id").in("merchant_id", ids).eq("status", "pending"),
      db.from("business_batches").select("merchant_id").in("merchant_id", ids).gte("created_at", todayStart),
    ]);
    for (const r of [m, pp, dp, ord, bat]) if (r.error) throw new Error(r.error.message);
    const mMap = new Map(((m.data ?? []) as any[]).map((x) => [x.id, x]));
    const pMap = new Map(((pp.data ?? []) as any[]).map((x) => [x.id, x.name]));
    const dMap = new Map(((dp.data ?? []) as any[]).map((x) => [x.id, x.name]));
    const count = (rows: any[]) => {
      const c = new Map<string, number>();
      for (const r of rows) c.set(r.merchant_id, (c.get(r.merchant_id) ?? 0) + 1);
      return c;
    };
    const stock = await Promise.all(ids.map(async (id: string) => {
      const { data } = await db.rpc("business_seal_stock", { _merchant_id: id });
      return [id, sealLow(data)] as const;
    }));
    const lowMap = new Map(stock);
    const oc = count(ord.data ?? []);
    const bc = count(bat.data ?? []);
    return list
      .map((p) => {
        const mm = mMap.get(p.merchant_id) ?? {};
        return {
          merchant_id: p.merchant_id,
          business_name: p.business_name || mm.store_name || "—",
          phone: mm.phone ?? null,
          city: p.city ?? mm.city ?? null,
          delivery_status: mm.delivery_status ?? null,
          store_enabled: !!mm.store_enabled,
          delivery_enabled: !!mm.delivery_enabled,
          pricing_plan_id: p.pricing_plan_id,
          dispatch_plan_id: p.dispatch_plan_id,
          pricing_plan: p.pricing_plan_id ? (pMap.get(p.pricing_plan_id) ?? null) : null,
          dispatch_plan: p.dispatch_plan_id ? (dMap.get(p.dispatch_plan_id) ?? null) : null,
          vehicle_type_id: p.vehicle_type_id,
          courier_type_id: p.courier_type_id,
          low_balance_threshold: Number(p.low_balance_threshold ?? 0),
          wallet_balance: Number(mm.delivery_wallet_balance ?? 0),
          pending_orders: oc.get(p.merchant_id) ?? 0,
          trips_today: bc.get(p.merchant_id) ?? 0,
          seal_low: lowMap.get(p.merchant_id) ?? false,
        } as BusinessRow;
      })
      .sort((a, b) => a.business_name.localeCompare(b.business_name));
  });

export const createBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { phone: string; business_name: string; city: string }) => {
    if (!i?.phone?.trim() || !i.business_name?.trim() || !i.city?.trim())
      throw new Error("Phone, business name and city are required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const found = await findByPhone(context as Ctx, i.phone);
    const id = await rpc(context as Ctx, "staff_create_business_account", {
      _phone: i.phone.trim(), _business_name: i.business_name.trim(), _city: i.city.trim(),
    });
    return { merchantId: id as string, linkedExisting: !!found, existingName: found?.store_name ?? null };
  });

export type PhoneLookup = {
  merchant_id: string; store_name: string | null; city: string | null; status: string | null; is_business: boolean;
} | null;

async function findByPhone(context: Ctx, phone: string): Promise<PhoneLookup> {
  const p10 = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (p10.length !== 10) return null;
  const { data, error } = await context.supabase
    .from("merchants").select("id, phone, store_name, city, status, auth_user_id, created_at")
    .ilike("phone", `%${p10}`).limit(10);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as any[])
    .filter((m) => String(m.phone ?? "").replace(/\D/g, "").slice(-10) === p10)
    .sort((a, b) => Number(!!b.auth_user_id) - Number(!!a.auth_user_id) || String(a.created_at).localeCompare(String(b.created_at)));
  const m = rows[0];
  if (!m) return null;
  const { data: bp } = await context.supabase.from("business_profiles").select("merchant_id").eq("merchant_id", m.id).maybeSingle();
  return { merchant_id: m.id, store_name: m.store_name, city: m.city, status: m.status, is_business: !!bp };
}

export const lookupBusinessPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { phone: string }) => i)
  .handler(async ({ data: i, context }): Promise<PhoneLookup> => {
    await requireOps(context as Ctx);
    return findByPhone(context as Ctx, i.phone);
  });

export type StoreSearchRow = {
  merchant_id: string; store_name: string | null; phone: string | null;
  city: string | null; status: string | null; is_business: boolean;
};

/** Search registered stores/merchants by name or phone for the Add business flow. */
export const searchStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { q: string }) => i)
  .handler(async ({ data: i, context }): Promise<StoreSearchRow[]> => {
    await requireOps(context as Ctx);
    const db = (context as Ctx).supabase;
    const q = (i.q ?? "").trim();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    const filters = [`store_name.ilike.%${q}%`, `owner_name.ilike.%${q}%`];
    if (digits.length >= 4) filters.push(`phone.ilike.%${digits}%`);
    const { data, error } = await db
      .from("merchants")
      .select("id, store_name, owner_name, phone, city, status")
      .is("deleted_at", null)
      .or(filters.join(","))
      .order("store_name")
      .limit(20);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (!rows.length) return [];
    const { data: bps } = await db
      .from("business_profiles").select("merchant_id").in("merchant_id", rows.map((r) => r.id));
    const bizIds = new Set(((bps ?? []) as any[]).map((b) => b.merchant_id));
    return rows.map((m) => ({
      merchant_id: m.id, store_name: m.store_name, phone: m.phone,
      city: m.city, status: m.status, is_business: bizIds.has(m.id),
    }));
  });

/** Read the Store / Bulk Delivery module flags for one merchant. */
export const getMerchantModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string }) => i)
  .handler(async ({ data: i, context }): Promise<{ store_enabled: boolean; delivery_enabled: boolean; delivery_status: string | null; canWrite: boolean }> => {
    const a = await requireOps(context as Ctx);
    const { data, error } = await (context as Ctx).supabase
      .from("merchants").select("store_enabled, delivery_enabled, delivery_status")
      .eq("id", i.merchant_id).maybeSingle();
    if (error) throw new Error(error.message);
    return {
      store_enabled: !!data?.store_enabled,
      delivery_enabled: !!data?.delivery_enabled,
      delivery_status: data?.delivery_status ?? null,
      canWrite: a.canWrite,
    };
  });


export const setBusinessModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; store_enabled: boolean; delivery_enabled: boolean; reason: string }) => {
    if (!i?.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_set_merchant_modules", {
      _merchant_id: i.merchant_id, _store_enabled: i.store_enabled,
      _delivery_enabled: i.delivery_enabled, _reason: i.reason.trim(),
    });
    return { ok: true };
  });

export const setBusinessDeliveryStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; status: string; reason: string }) => {
    if (!i?.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_set_delivery_status", {
      _merchant_id: i.merchant_id, _status: i.status, _reason: i.reason.trim(),
    });
    return { ok: true };
  });

export const assignBusinessPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; pricing_plan_id: string | null; dispatch_plan_id: string | null }) => i)
  .handler(async ({ data: i, context }) => {
    await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_assign_business_plans", {
      _merchant_id: i.merchant_id, _pricing_plan_id: i.pricing_plan_id, _dispatch_plan_id: i.dispatch_plan_id,
    });
    return { ok: true };
  });

export const saveBusinessDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; vehicle_type_id: string | null; courier_type_id: string | null; low_balance_threshold: number }) => i)
  .handler(async ({ data: i, context }) => {
    const db = (context as Ctx).supabase;
    const { data: p, error } = await db.from("business_profiles").select("*").eq("merchant_id", i.merchant_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Business profile not found");
    await rpc(context as Ctx, "staff_upsert_business_profile", {
      _merchant_id: i.merchant_id, _business_name: p.business_name, _gstin: p.gstin, _city: p.city,
      _vehicle_type_id: i.vehicle_type_id, _courier_type_id: i.courier_type_id,
      _batch_capacity: p.batch_capacity, _auto_time_enabled: p.auto_time_enabled,
      _time_slab_minutes: p.time_slab_minutes, _auto_qty_enabled: p.auto_qty_enabled,
      _qty_threshold: p.qty_threshold, _low_balance_threshold: i.low_balance_threshold,
    });
    return { ok: true };
  });

export type PickupPoint = {
  id: string; name: string; address: string; lat: number | null; lng: number | null;
  contact_name: string | null; contact_phone: string | null; is_default: boolean; is_active: boolean;
};

export const getBusinessDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string }) => i)
  .handler(async ({ data: i, context }) => {
    await requireOps(context as Ctx);
    const db = (context as Ctx).supabase;
    const [pp, rc, od, bt, wl, tu, vt, ct] = await Promise.all([
      db.from("business_pickup_points").select("*").eq("merchant_id", i.merchant_id).order("created_at"),
      db.from("business_receivers").select("id, name, contact_name, contact_phone, address, is_active").eq("merchant_id", i.merchant_id).order("name").limit(1000),
      db.from("business_orders").select("id, reference_no, receiver_id, status, batch_id, courier_order_id, packet_count, created_at").eq("merchant_id", i.merchant_id).order("created_at", { ascending: false }).limit(300),
      db.from("business_batches").select("id, status, fail_reason, drops_count, distance_km, distance_source, trip_no, trip_label, dispatch_run_id, total_amount, courier_order_id, trigger, created_at").eq("merchant_id", i.merchant_id).order("created_at", { ascending: false }).limit(200),
      db.from("wallet_ledger").select("id, amount, type, reason, created_at").eq("owner_type", "merchant").eq("owner_id", i.merchant_id).eq("wallet_type", "delivery").order("created_at", { ascending: false }).limit(300),
      db.from("business_wallet_topups").select("id, amount, status, razorpay_payment_id, created_by_label, created_at, paid_at").eq("merchant_id", i.merchant_id).order("created_at", { ascending: false }).limit(100),
      db.from("courier_vehicle_types").select("id, name").eq("is_active", true),
      db.from("courier_types").select("id, name").eq("is_active", true),
    ]);
    for (const r of [pp, rc, od, bt, wl, tu, vt, ct]) if (r.error) throw new Error(r.error.message);
    const riders = await riderNames(context as Ctx, ((bt.data ?? []) as any[]).map((b) => b.courier_order_id).filter(Boolean));
    const { data: runRows, error: runErr } = await db.from("business_dispatch_runs")
      .select("id, trigger, method, drops, trips, total_km, status, created_at")
      .eq("merchant_id", i.merchant_id).order("created_at", { ascending: false }).limit(200);
    if (runErr) throw new Error(runErr.message);
    return {
      runs: ((runRows ?? []) as any[]).map((r) => ({ ...r, drops: Number(r.drops ?? 0), trips: Number(r.trips ?? 0), total_km: r.total_km == null ? null : Number(r.total_km) })),
      pickups: (pp.data ?? []) as PickupPoint[],
      receivers: (rc.data ?? []) as any[],
      orders: (od.data ?? []) as any[],
      trips: ((bt.data ?? []) as any[]).map((b) => ({ ...b, rider_name: b.courier_order_id ? (riders.get(b.courier_order_id) ?? null) : null, total_amount: Number(b.total_amount ?? 0), distance_km: b.distance_km == null ? null : Number(b.distance_km) })),
      ledger: ((wl.data ?? []) as any[]).map((l) => ({ ...l, amount: Number(l.amount) })),
      topups: ((tu.data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })),
      vehicleTypes: (vt.data ?? []) as Array<{ id: string; name: string }>,
      courierTypes: (ct.data ?? []) as Array<{ id: string; name: string }>,
    };
  });

export const savePickupPoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Omit<PickupPoint, "id"> & { merchant_id: string; id: string | null }) => {
    if (!i?.name?.trim() || !i.address?.trim()) throw new Error("Name and address required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(context as Ctx, "staff_upsert_pickup_point", {
      _merchant_id: i.merchant_id, _id: i.id, _name: i.name.trim(), _address: i.address.trim(),
      _lat: i.lat, _lng: i.lng, _contact_name: i.contact_name, _contact_phone: i.contact_phone,
      _is_default: i.is_default, _is_active: i.is_active,
    });
    return { ok: true };
  });

export const businessDispatchNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; reason: string }) => {
    if (!i?.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const r = await rpc(context as Ctx, "staff_business_dispatch_now", {
      _merchant_id: i.merchant_id, _reason: i.reason.trim(),
    });
    return { result: JSON.stringify(r ?? {}) };
  });

export const businessWalletAdjust = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; type: "credit" | "debit"; amount: number; reason: string }) => {
    if (!(i?.amount > 0)) throw new Error("Amount must be positive");
    if (!i.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(await requireSuper(context as Ctx).then(() => context as Ctx), "staff_business_wallet_adjust", {
      _merchant_id: i.merchant_id, _type: i.type, _amount: i.amount, _reason: i.reason.trim(),
    });
    return { ok: true };
  });

/** courier_order_id -> assigned rider name */
async function riderNames(context: Ctx, orderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!orderIds.length) return out;
  const { data: cos, error } = await context.supabase.from("courier_orders").select("id, assigned_expert_id").in("id", orderIds);
  if (error) throw new Error(error.message);
  const eids = [...new Set(((cos ?? []) as any[]).map((c) => c.assigned_expert_id).filter(Boolean))];
  if (!eids.length) return out;
  const { data: ex } = await context.supabase.from("experts").select("id, name").in("id", eids);
  const en = new Map(((ex ?? []) as any[]).map((e) => [e.id, e.name]));
  for (const c of (cos ?? []) as any[]) if (c.assigned_expert_id) out.set(c.id, en.get(c.assigned_expert_id) ?? "Rider");
  return out;
}

export type UnassignedTrip = {
  courier_order_id: string; batch_id: string | null; order_code: string | null; status: string; merchant_id: string | null;
  business_name: string; trip_no: number | null; trip_label: string | null; drops: number;
  total_amount: number; search_started_at: string | null; needs_ops_attention: boolean;
};

/** Backend list: business courier orders still searching with no rider. */
export const listUnassignedBusinessTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UnassignedTrip[]> => {
    const rows = ((await rpc(context as Ctx, "staff_list_unassigned_business_trips", {})) ?? []) as any[];
    return rows.map((r) => ({
      courier_order_id: r.courier_order_id, batch_id: r.batch_id ?? null,
      order_code: r.order_code ?? null, status: r.status,
      merchant_id: r.merchant_id ?? null, business_name: r.business_name ?? "—",
      trip_no: r.trip_no == null ? null : Number(r.trip_no), trip_label: r.trip_label ?? null,
      drops: Number(r.drops ?? 0), total_amount: Number(r.total_amount ?? 0),
      search_started_at: r.search_started_at ?? null, needs_ops_attention: !!r.needs_ops_attention,
    }));
  });

export const rejectBusinessTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { courier_order_id: string; reason: string }) => {
    if (!i?.courier_order_id) throw new Error("Trip required");
    if (!i.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const db = (context as Ctx).supabase;
    const { data: b, error } = await db.from("business_batches").select("id").eq("courier_order_id", i.courier_order_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!b) throw new Error("Trip not found");
    await rpc(context as Ctx, "staff_business_reject_trip", { _batch_id: b.id, _reason: i.reason.trim() });
    return { ok: true };
  });

/* ------------------------------ seal stickers ------------------------------ */

function sealLow(d: any): boolean {
  const avg = Number(d?.avg_used_per_day_7d ?? 0);
  return avg > 0 && Number(d?.available ?? 0) < avg * 3;
}

export type SealBatch = {
  id: string; batch_no: number; serial_from: number; serial_to: number; total: number;
  merchant_id: string | null; business: string | null; notes: string | null; created_at: string;
  available: number; used: number; void: number; charge_amount: number;
};

export const listSealBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ batches: SealBatch[]; nextSerial: number }> => {
    await requireOps(context as Ctx);
    const db = (context as Ctx).supabase;
    const { data: b, error } = await db.from("business_seal_batches").select("*").order("batch_no", { ascending: false });
    if (error) throw new Error(error.message);
    const batches = (b ?? []) as any[];
    const mids = [...new Set(batches.map((x) => x.merchant_id).filter(Boolean))];
    const names = new Map<string, string>();
    if (mids.length) {
      const { data: m } = await db.from("merchants").select("id, store_name").in("id", mids);
      for (const r of (m ?? []) as any[]) names.set(r.id, r.store_name);
    }
    const counts = new Map<string, { available: number; used: number; void: number }>();
    await Promise.all(batches.map(async (x) => {
      const c = { available: 0, used: 0, void: 0 };
      await Promise.all((["available", "used", "void"] as const).map(async (st) => {
        const { count } = await db.from("business_seal_stickers").select("serial", { count: "exact", head: true }).eq("batch_id", x.id).eq("status", st);
        c[st] = count ?? 0;
      }));
      counts.set(x.id, c);
    }));
    const maxTo = batches.reduce((m, x) => Math.max(m, Number(x.serial_to ?? 0)), 0);
    return {
      nextSerial: maxTo ? maxTo + 1 : 1000001,
      batches: batches.map((x) => ({
        id: x.id, batch_no: Number(x.batch_no), serial_from: Number(x.serial_from), serial_to: Number(x.serial_to),
        total: Number(x.serial_to) - Number(x.serial_from) + 1, merchant_id: x.merchant_id,
        business: x.merchant_id ? (names.get(x.merchant_id) ?? "—") : null, notes: x.notes, created_at: x.created_at,
        charge_amount: Number(x.charge_amount ?? 0), ...(counts.get(x.id) ?? { available: 0, used: 0, void: 0 }),
      })),
    };
  });

export const listDeliveryMerchants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOps(context as Ctx);
    const { data, error } = await (context as Ctx).supabase.from("merchants")
      .select("id, store_name, delivery_wallet_balance").eq("delivery_enabled", true).is("deleted_at", null).order("store_name");
    if (error) throw new Error(error.message);
    return ((data ?? []) as any[]).map((m) => ({ id: m.id as string, name: (m.store_name as string) ?? "—", balance: Number(m.delivery_wallet_balance ?? 0) }));
  });

function sealErr(r: any, fallback: string) {
  if (r && typeof r === "object" && r.ok === false) {
    const e = String(r.error ?? "");
    if (e === "INSUFFICIENT_WALLET") throw new Error("Not enough balance in the delivery wallet for this sticker charge.");
    throw new Error(String(r.message ?? e) || fallback);
  }
  return r;
}

export const createSealBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { from: number; to: number; notes: string }) => {
    if (!Number.isInteger(i.from) || !Number.isInteger(i.to) || i.from <= 0 || i.to < i.from) throw new Error("Enter a valid serial range");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await requireSuper(context as Ctx);
    return sealErr(await rpc(context as Ctx, "staff_seal_create_batch", { _serial_from: i.from, _serial_to: i.to, _notes: i.notes.trim() || null }), "Could not create batch");
  });

export const assignSealBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { batch_id: string; merchant_id: string; charge: number | null }) => {
    if (!i.merchant_id) throw new Error("Pick a business");
    if (i.charge != null && i.charge < 0) throw new Error("Charge cannot be negative");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await requireSuper(context as Ctx);
    try {
      return sealErr(await rpc(context as Ctx, "staff_seal_assign_batch", { _batch_id: i.batch_id, _merchant_id: i.merchant_id, _charge_amount: i.charge ?? 0 }), "Could not assign");
    } catch (e) {
      if (e instanceof Error && e.message.includes("INSUFFICIENT_WALLET")) throw new Error("Not enough balance in the delivery wallet for this sticker charge.");
      throw e;
    }
  });

export const exportSealBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { batch_id: string }) => i)
  .handler(async ({ data: i, context }) => {
    await requireOps(context as Ctx);
    return ((await rpc(context as Ctx, "staff_seal_batch_export", { _batch_id: i.batch_id })) ?? []) as Array<{ serial: number; code: string; qr_payload: string; printed_text: string }>;
  });

export const lookupSeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { q: string }) => i)
  .handler(async ({ data: i, context }) => {
    await requireOps(context as Ctx);
    return (await rpc(context as Ctx, "staff_seal_lookup", { _raw: i.q.trim() })) as Record<string, any>;
  });

export const voidSeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { code: string; reason: string }) => {
    if (!i.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await requireOps(context as Ctx);
    return sealErr(await rpc(context as Ctx, "staff_seal_void", { _code: i.code, _reason: i.reason.trim() }), "Could not void");
  });

export const getSealStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string }) => i)
  .handler(async ({ data: i, context }) => {
    await requireOps(context as Ctx);
    const db = (context as Ctx).supabase;
    const d = (await rpc(context as Ctx, "business_seal_stock", { _merchant_id: i.merchant_id })) ?? {};
    const startIst = new Date(Date.now() + 5.5 * 3600e3);
    startIst.setUTCHours(0, 0, 0, 0);
    const todayStart = new Date(startIst.getTime() - 5.5 * 3600e3).toISOString();
    const { count } = await db.from("business_seal_stickers").select("serial", { count: "exact", head: true })
      .eq("merchant_id", i.merchant_id).eq("status", "used").gte("used_at", todayStart);
    const available = Number(d.available ?? 0);
    const avg = Number(d.avg_used_per_day_7d ?? 0);
    return { available, usedToday: count ?? 0, avgPerDay: avg, daysLeft: avg > 0 ? available / avg : null, low: sealLow(d) };
  });
