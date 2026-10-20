import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };
const uniqueIds = (ids: string[]) => [...new Set(ids)];

async function staffRole(context: Ctx) {
  const { data } = await context.supabase.from("staff_users").select("role, status").eq("auth_user_id", context.userId).maybeSingle();
  if (!data || data.status !== "active") throw new Error("Forbidden");
  return data.role as string;
}
async function assertManager(context: Ctx) {
  const r = await staffRole(context);
  if (r !== "super_admin" && r !== "ops_manager") throw new Error("Only Super Admin or Ops Manager can do this");
}

export type ParcelTrainingOrder = {
  id: string; orderNumber: string | null; status: string; pickup: string; drop: string;
  totalAmount: number; createdAt: string; riderName: string | null;
  otps: { type: string; otp: string | null }[];
};

// Training SEARCHING uses only selected recipients, never live riders.
const NEXT: Record<string, string[]> = {
  REQUESTED: ["SEARCHING", "CANCELLED"],
  SEARCHING: ["CANCELLED"],
  DRIVER_ASSIGNED: ["ARRIVED_PICKUP", "CANCELLED"],
  ARRIVED_PICKUP: ["PICKED_UP", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "CANCELLED"],
};
const OPEN = Object.keys(NEXT);

export const getParcelTrainingData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await staffRole(context);
    const db = context.supabase;
    const [vt, ct, ex, os] = await Promise.all([
      db.from("courier_vehicle_types").select("id, name").order("name"),
      db.from("courier_types").select("id, name").order("name"),
      db.from("experts").select("id, name").eq("mode", "TRAINING").eq("status", "active").order("name"),
      db.from("courier_orders")
        .select("id, order_code, status, pickup_address, drop_address, total_amount, created_at, assigned_expert_id")
        .eq("is_training", true).eq("source", "parcel").order("created_at", { ascending: false }).limit(100),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const experts = ((ex.data ?? []) as any[]).map((e) => ({ id: e.id as string, name: e.name as string }));
    const nameOf = new Map(experts.map((e) => [e.id, e.name]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (os.data ?? []) as any[];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { trainingStopOtps } = await import("@/lib/training-otps.server");
    const otpMap = await trainingStopOtps(supabaseAdmin, raw.map((o) => o.id));
    const orders: ParcelTrainingOrder[] = raw.map((o) => ({
      id: o.id, orderNumber: o.order_code ?? null, status: o.status, pickup: o.pickup_address, drop: o.drop_address,
      totalAmount: Number(o.total_amount) || 0, createdAt: o.created_at,
      riderName: o.assigned_expert_id ? nameOf.get(o.assigned_expert_id) ?? "Rider" : null,
      otps: otpMap.get(o.id) ?? [],
    }));
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vehicles: ((vt.data ?? []) as any[]).map((v) => ({ id: v.id as string, name: String(v.name ?? "Vehicle") })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      types: ((ct.data ?? []) as any[]).map((v) => ({ id: v.id as string, name: String(v.name ?? "Parcel") })),
      experts, orders, canManage: role === "super_admin" || role === "ops_manager", isSuper: role === "super_admin",
    };
  });

/** Permanently delete training parcels (Super Admin only). */
export const deleteParcelTrainingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!d?.id) throw new Error("Missing order"); return d; })
  .handler(async ({ data, context }) => {
    if ((await staffRole(context)) !== "super_admin") throw new Error("Only Super Admin can delete training orders");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await db.from("courier_orders").delete().eq("id", data.id).eq("is_training", true).select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("Training order not found");
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "parcel_training_order_deleted", target_table: "courier_orders", target_id: data.id });
    return { ok: true };
  });

export const createParcelTrainingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { vehicleTypeId: string; courierTypeId: string; pickup: string; drop: string; amount: number; expertIds: string[] }) => {
    if (!d.vehicleTypeId || !d.courierTypeId) throw new Error("Pick a vehicle and parcel type");
    if (!d.pickup?.trim() || !d.drop?.trim()) throw new Error("Enter pickup and drop addresses");
    if (!Array.isArray(d.expertIds) || !d.expertIds.length) throw new Error("Select at least one training rider");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { data: expert, error: expertError } = await context.supabase.from("experts").select("city_id").eq("id", data.expertIds[0]).single();
    if (expertError || !expert?.city_id) throw new Error("Couldn't verify the selected rider's city");
    const { error: validationError } = await context.supabase.rpc("staff_validate_training_experts", { _ids: uniqueIds(data.expertIds), _city: expert.city_id });
    if (validationError) throw new Error(validationError.message);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: s } = await db.from("ops_settings").select("value").eq("key", "training_address").maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let v: any = s?.value;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
    const lat = Number(v?.latitude) || 18.4088;
    const lng = Number(v?.longitude) || 76.5604;
    const city = String(v?.city || "Latur");
    const amount = Math.max(0, Number(data.amount) || 0);
    const { data: row, error } = await db.from("courier_orders").insert({
      customer_id: context.userId,
      city,
      city_id: expert.city_id,
      courier_type_id: data.courierTypeId,
      vehicle_type_id: data.vehicleTypeId,
      pickup_address: data.pickup, pickup_lat: lat, pickup_lng: lng,
      pickup_contact_name: "Training Sender", pickup_contact_phone: "9999999999",
      drop_address: data.drop, drop_lat: lat + 0.01, drop_lng: lng + 0.01,
      drop_contact_name: "Training Receiver", drop_contact_phone: "9999999998",
      status: "SEARCHING",
      training_expert_ids: uniqueIds(data.expertIds),
      payment_status: "pending",
      total_amount: amount,
      is_training: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "parcel_training_order_created", target_table: "courier_orders", target_id: row.id, after_state: { amount, expert_ids: data.expertIds } });
    const { error: dispatchError } = await db.rpc("courier_dispatch_next", { _order_id: row.id });
    if (dispatchError) throw new Error(dispatchError.message);
    return { id: row.id as string };
  });

export const advanceParcelTrainingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; to: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: o } = await db.from("courier_orders").select("id, status, is_training").eq("id", data.id).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!o || !(o as any).is_training) throw new Error("Only training orders can be simulated");
    if (!(NEXT[o.status] ?? []).includes(data.to)) throw new Error(`Cannot move from ${o.status} to ${data.to}`);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.to };
    if (data.to === "ARRIVED_PICKUP") patch.arrived_pickup_at = now;
    if (data.to === "CANCELLED") { patch.cancelled_by = "staff"; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from("courier_orders").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "parcel_training_order_status", target_table: "courier_orders", target_id: data.id, before_state: { status: o.status }, after_state: { status: data.to } });
    return { ok: true };
  });

export const clearParcelTrainingOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data, error } = await db.from("courier_orders")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ status: "CANCELLED", cancelled_by: "staff" } as any)
      .eq("is_training", true).in("status", OPEN).select("id");
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "parcel_training_orders_cleared", target_table: "courier_orders", after_state: { count: data?.length ?? 0 } });
    return { count: data?.length ?? 0 };
  });
