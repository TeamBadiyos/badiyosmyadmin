import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function staffRole(context: Ctx) {
  const { data } = await context.supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (!data || data.status !== "active") throw new Error("Forbidden");
  return data.role as string;
}
async function assertManager(context: Ctx) {
  const r = await staffRole(context);
  if (r !== "super_admin" && r !== "ops_manager") throw new Error("Only Super Admin or Ops Manager can do this");
}

export type StoreTrainingStore = { id: string; name: string; products: { id: string; name: string; price: number; unit: string | null }[] };
export type StoreTrainingOrder = {
  id: string; orderNumber: string; status: string; storeName: string; customerName: string | null;
  totalAmount: number; createdAt: string; items: { name: string; qty: number; price: number }[];
};

export const getStoreTrainingData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await staffRole(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: ms } = await db.from("merchants").select("id, store_name, status").eq("status", "approved").order("store_name").limit(300);
    const ids = (ms ?? []).map((m: any) => m.id);
    const { data: ps } = ids.length
      ? await db.from("products").select("id, name, price, unit, merchant_id").in("merchant_id", ids).eq("is_active", true).limit(5000)
      : { data: [] as any[] };
    const stores: StoreTrainingStore[] = (ms ?? []).map((m: any) => ({
      id: m.id, name: m.store_name ?? "Store",
      products: (ps ?? []).filter((p: any) => p.merchant_id === m.id).map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price) || 0, unit: p.unit })),
    })).filter((s) => s.products.length > 0);

    const { data: os } = await db.from("merchant_orders")
      .select("id, order_number, status, merchant_id, customer_name, total_amount, created_at")
      .eq("is_training", true).order("created_at", { ascending: false }).limit(100);
    const oIds = (os ?? []).map((o: any) => o.id);
    const { data: its } = oIds.length
      ? await db.from("merchant_order_items").select("order_id, product_name_snapshot, quantity, price_snapshot").in("order_id", oIds)
      : { data: [] as any[] };
    const mIds = [...new Set((os ?? []).map((o: any) => o.merchant_id))];
    const { data: mn } = mIds.length ? await db.from("merchants").select("id, store_name").in("id", mIds) : { data: [] as any[] };
    const nameOf = new Map((mn ?? []).map((m: any) => [m.id, m.store_name]));
    const orders: StoreTrainingOrder[] = (os ?? []).map((o: any) => ({
      id: o.id, orderNumber: o.order_number, status: o.status, storeName: nameOf.get(o.merchant_id) ?? "Store",
      customerName: o.customer_name, totalAmount: Number(o.total_amount) || 0, createdAt: o.created_at,
      items: (its ?? []).filter((i: any) => i.order_id === o.id).map((i: any) => ({ name: i.product_name_snapshot, qty: i.quantity, price: Number(i.price_snapshot) })),
    }));
    return { stores, orders, canManage: role === "super_admin" || role === "ops_manager" };
  });

export const createStoreTrainingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { merchantId: string; items: { productId: string; qty: number }[]; customerName: string; customerPhone: string; address: string; paymentMode: "online" | "cod" }) => {
    if (!d.merchantId || !Array.isArray(d.items) || d.items.length === 0) throw new Error("Pick a store and at least one item");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: ps, error: pe } = await db.from("products").select("id, name, price, merchant_id")
      .in("id", data.items.map((i) => i.productId)).eq("merchant_id", data.merchantId);
    if (pe) throw new Error(pe.message);
    const lines = data.items.map((i) => {
      const p = (ps ?? []).find((x: any) => x.id === i.productId);
      if (!p) throw new Error("Item not found in this store");
      return { p, qty: Math.max(1, Math.floor(i.qty)) };
    });
    const itemsTotal = lines.reduce((s, l) => s + Number(l.p.price) * l.qty, 0);
    let commission = { commission_pct: 0, commission_amount: 0, commission_gst_pct: 0, commission_gst_amount: 0, merchant_net: itemsTotal } as any;
    const { data: snap } = await db.rpc("store_commission_snapshot" as any, { _merchant_id: data.merchantId, _base: itemsTotal } as any);
    if (snap) commission = { ...commission, ...(snap as any) };
    const now = new Date().toISOString();
    const online = data.paymentMode === "online";
    const { data: order, error } = await db.from("merchant_orders").insert({
      merchant_id: data.merchantId,
      order_number: `TRN-${Date.now().toString().slice(-8)}`,
      status: "pending",
      source: "training",
      payment_mode: online ? "online" : "cod",
      payment_status: online ? "paid" : "pending",
      paid_at: online ? now : null,
      placed_at: now,
      items_total: itemsTotal,
      total_amount: itemsTotal,
      delivery_fee: 0,
      commission_pct: Number(commission.commission_pct) || 0,
      commission_amount: Number(commission.commission_amount) || 0,
      commission_gst_pct: Number(commission.commission_gst_pct) || 0,
      commission_gst_amount: Number(commission.commission_gst_amount) || 0,
      merchant_net: Number(commission.merchant_net) || itemsTotal,
      customer_name: data.customerName || "Training Customer",
      customer_phone: data.customerPhone || null,
      delivery_address: data.address || "Training address",
      customer_note: "TRAINING ORDER — do not deliver",
      is_training: true,
    } as any).select("id").single();
    if (error) throw new Error(error.message);
    const { error: ie } = await db.from("merchant_order_items").insert(lines.map((l) => ({
      order_id: order.id, product_id: l.p.id, product_name_snapshot: l.p.name, price_snapshot: Number(l.p.price), quantity: l.qty,
    })));
    if (ie) throw new Error(ie.message);
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "store_training_order_created", target_table: "merchant_orders", target_id: order.id, after_state: { itemsTotal, merchantId: data.merchantId } });
    return { id: order.id };
  });

const NEXT: Record<string, string[]> = {
  pending: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
};

export const advanceStoreTrainingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; to: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: o } = await db.from("merchant_orders").select("id, status, is_training").eq("id", data.id).maybeSingle();
    if (!o || !(o as any).is_training) throw new Error("Only training orders can be simulated");
    if (!(NEXT[o.status] ?? []).includes(data.to)) throw new Error(`Cannot move from ${o.status} to ${data.to}`);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.to };
    if (data.to === "completed") { patch.picked_up_at = now; patch.delivered_at = now; }
    if (data.to === "cancelled") { patch.cancelled_at = now; patch.cancel_reason = "Training order cancelled"; }
    const { error } = await db.from("merchant_orders").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "store_training_order_status", target_table: "merchant_orders", target_id: data.id, before_state: { status: o.status }, after_state: { status: data.to } });
    return { ok: true };
  });

export const clearStoreTrainingOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data, error } = await db.from("merchant_orders")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Training cleared" } as any)
      .eq("is_training", true).in("status", ["pending", "accepted", "preparing", "ready"]).select("id");
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({ actor_id: context.userId, action: "store_training_orders_cleared", target_table: "merchant_orders", after_state: { count: data?.length ?? 0 } });
    return { count: data?.length ?? 0 };
  });
