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
  return { role: data.role as string, canWrite: true };
}

async function rpc(context: Ctx, name: string, args: Record<string, unknown>) {
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export type PricingPlan = {
  id: string; name: string; base_fare: number; included_km: number; per_km: number;
  min_fare: number; extra_drop_fee: number; return_per_km: number; commission_pct: number;
  is_active: boolean; used_by: number;
};
export type DispatchPlan = {
  id: string; name: string; manual_enabled: boolean; qty_enabled: boolean; qty_threshold: number | null;
  slots_enabled: boolean; slot_times: string[]; max_drops_per_batch: number | null;
  is_active: boolean; used_by: number;
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
      })),
      dispatch: ((d.dispatch ?? []) as any[]).map((p) => ({
        ...p,
        slot_times: ((p.slot_times ?? []) as string[]).map((t) => String(t).slice(0, 5)),
        used_by: Number(p.used_by ?? 0),
      })),
    };
  });

export const savePricingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Omit<PricingPlan, "used_by" | "id"> & { id: string | null }) => {
    if (!i?.name?.trim()) throw new Error("Name required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(context as Ctx, "staff_upsert_pricing_plan", {
      _id: i.id, _name: i.name.trim(), _base_fare: i.base_fare, _included_km: i.included_km,
      _per_km: i.per_km, _min_fare: i.min_fare, _extra_drop_fee: i.extra_drop_fee,
      _return_per_km: i.return_per_km, _commission_pct: i.commission_pct, _is_active: i.is_active,
    });
    return { ok: true };
  });

export const saveDispatchPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Omit<DispatchPlan, "used_by" | "id"> & { id: string | null }) => {
    if (!i?.name?.trim()) throw new Error("Name required");
    if (!i.manual_enabled && !i.qty_enabled && !i.slots_enabled && !i.max_drops_per_batch)
      throw new Error("Tick at least one option");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(context as Ctx, "staff_upsert_dispatch_plan", {
      _id: i.id, _name: i.name.trim(), _manual_enabled: i.manual_enabled,
      _qty_enabled: i.qty_enabled, _qty_threshold: i.qty_enabled ? i.qty_threshold : null,
      _slots_enabled: i.slots_enabled, _slot_times: i.slots_enabled ? i.slot_times : [],
      _max_drops_per_batch: i.max_drops_per_batch, _is_active: i.is_active,
    });
    return { ok: true };
  });

export const setPlanActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: "pricing" | "dispatch"; id: string; active: boolean }) => i)
  .handler(async ({ data: i, context }) => {
    const r = await rpc(context as Ctx, "staff_set_plan_active", {
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
    const id = await rpc(context as Ctx, "staff_create_business_account", {
      _phone: i.phone.trim(), _business_name: i.business_name.trim(), _city: i.city.trim(),
    });
    return { merchantId: id as string };
  });

export const setBusinessModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; store_enabled: boolean; delivery_enabled: boolean; reason: string }) => {
    if (!i?.reason?.trim()) throw new Error("Reason required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    await rpc(context as Ctx, "staff_set_merchant_modules", {
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
    await rpc(context as Ctx, "staff_set_delivery_status", {
      _merchant_id: i.merchant_id, _status: i.status, _reason: i.reason.trim(),
    });
    return { ok: true };
  });

export const assignBusinessPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string; pricing_plan_id: string | null; dispatch_plan_id: string | null }) => i)
  .handler(async ({ data: i, context }) => {
    await rpc(context as Ctx, "staff_assign_business_plans", {
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
      db.from("business_batches").select("id, status, fail_reason, drops_count, distance_km, total_amount, courier_order_id, trigger, created_at").eq("merchant_id", i.merchant_id).order("created_at", { ascending: false }).limit(200),
      db.from("wallet_ledger").select("id, amount, type, reason, created_at").eq("owner_type", "merchant").eq("owner_id", i.merchant_id).eq("wallet_type", "delivery").order("created_at", { ascending: false }).limit(300),
      db.from("business_wallet_topups").select("id, amount, status, razorpay_payment_id, created_by_label, created_at, paid_at").eq("merchant_id", i.merchant_id).order("created_at", { ascending: false }).limit(100),
      db.from("courier_vehicle_types").select("id, name").eq("is_active", true),
      db.from("courier_types").select("id, name").eq("is_active", true),
    ]);
    for (const r of [pp, rc, od, bt, wl, tu, vt, ct]) if (r.error) throw new Error(r.error.message);
    return {
      pickups: (pp.data ?? []) as PickupPoint[],
      receivers: (rc.data ?? []) as any[],
      orders: (od.data ?? []) as any[],
      trips: ((bt.data ?? []) as any[]).map((b) => ({ ...b, total_amount: Number(b.total_amount ?? 0), distance_km: b.distance_km == null ? null : Number(b.distance_km) })),
      ledger: ((wl.data ?? []) as any[]).map((l) => ({ ...l, amount: Number(l.amount) })),
      topups: ((tu.data ?? []) as any[]).map((t) => ({ ...t, amount: Number(t.amount) })),
      vehicleTypes: (vt.data ?? []) as Array<{ id: string; name: string }>,
      courierTypes: (ct.data ?? []) as Array<{ id: string; name: string }>,
    };
  });

export const savePickupPoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: PickupPoint & { merchant_id: string; id: string | null }) => {
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
    await rpc(context as Ctx, "staff_business_wallet_adjust", {
      _merchant_id: i.merchant_id, _type: i.type, _amount: i.amount, _reason: i.reason.trim(),
    });
    return { ok: true };
  });
