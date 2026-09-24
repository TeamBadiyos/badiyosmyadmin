import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CommerceStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed";

export type CommerceAlert = "merchant_slow" | "no_rider" | "pickup_delayed";

export type RiderState = "none" | "searching" | "assigned" | "picked_up";

export type CommerceOrder = {
  id: string;
  orderNumber: string;
  status: CommerceStatus;
  merchantName: string;
  customerName: string;
  totalAmount: number;
  paymentMode: string | null;
  paymentStatus: string | null;
  createdAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  courierOrderId: string | null;
  courierStatus: string | null;
  riderName: string | null;
  riderState: RiderState;
  alerts: CommerceAlert[];
};

export type CommercePipeline = {
  orders: CommerceOrder[];
  offlineToday: { count: number; revenue: number };
  canManage: boolean;
};

const MERCHANT_ACCEPT_MIN = 5;
const PICKUP_AFTER_READY_MIN = 20;
const RIDER_SEARCH_MIN = 15;

type Ctx = { supabase: any; userId: string };

async function getStaff(context: Ctx) {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("id, status, role")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  return data as { id: string; role: string };
}

async function assertManager(context: Ctx) {
  const s = await getStaff(context);
  if (s.role !== "super_admin" && s.role !== "ops_manager") {
    throw new Error("Only super admin or ops manager can do this");
  }
  return s;
}

const minsSince = (iso: string | null, now: number) =>
  iso ? (now - new Date(iso).getTime()) / 60000 : 0;

export const listCommercePipeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { segmentId?: string | null }) => ({
    segmentId: input?.segmentId ?? null,
  }))
  .handler(async ({ data, context }): Promise<CommercePipeline> => {
    const db = context.supabase;
    const staff = await getStaff(context);
    const canManage = staff.role === "super_admin" || staff.role === "ops_manager";

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();

    let merchantIds: string[] | null = null;
    if (data.segmentId) {
      const { data: ms, error } = await db
        .from("merchants")
        .select("id")
        .eq("segment_id", data.segmentId);
      if (error) throw new Error(error.message);
      merchantIds = (ms ?? []).map((m: any) => m.id as string);
      if (merchantIds!.length === 0) {
        return { orders: [], offlineToday: { count: 0, revenue: 0 }, canManage };
      }
    }

    const cols =
      "id, order_number, status, merchant_id, user_id, customer_name, total_amount, payment_mode, payment_status, created_at, accepted_at, ready_at, picked_up_at, courier_order_id";

    let openQ = db
      .from("merchant_orders")
      .select(cols)
      .in("status", ["pending", "accepted", "preparing", "ready"])
      .order("created_at", { ascending: false })
      .limit(200);
    let doneQ = db
      .from("merchant_orders")
      .select(cols)
      .eq("status", "completed")
      .gte("created_at", startOfDay)
      .order("created_at", { ascending: false })
      .limit(200);
    let offlineQ = db
      .from("offline_sales")
      .select("total_amount")
      .gte("created_at", startOfDay)
      .limit(1000);

    if (merchantIds) {
      openQ = openQ.in("merchant_id", merchantIds);
      doneQ = doneQ.in("merchant_id", merchantIds);
      offlineQ = offlineQ.in("merchant_id", merchantIds);
    }

    const [openRes, doneRes, offlineRes] = await Promise.all([openQ, doneQ, offlineQ]);
    if (openRes.error) throw new Error(openRes.error.message);
    if (doneRes.error) throw new Error(doneRes.error.message);
    if (offlineRes.error) throw new Error(offlineRes.error.message);

    const rows: any[] = [...(openRes.data ?? []), ...(doneRes.data ?? [])];
    const uniq = (xs: unknown[]) =>
      Array.from(new Set(xs.filter(Boolean) as string[]));

    const mIds = uniq(rows.map((r) => r.merchant_id));
    const uIds = uniq(rows.filter((r) => !r.customer_name).map((r) => r.user_id));
    const cIds = uniq(rows.map((r) => r.courier_order_id));

    const [mRes, uRes, cRes] = await Promise.all([
      mIds.length
        ? db.from("merchants").select("id, store_name").in("id", mIds)
        : Promise.resolve({ data: [], error: null }),
      uIds.length
        ? db.from("users").select("id, full_name").in("id", uIds)
        : Promise.resolve({ data: [], error: null }),
      cIds.length
        ? db
            .from("courier_orders")
            .select("id, status, assigned_expert_id, search_started_at, picked_up_at, needs_ops_attention")
            .in("id", cIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (mRes.error) throw new Error(mRes.error.message);
    if (uRes.error) throw new Error(uRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);

    const merchantMap = new Map<string, string>(
      (mRes.data ?? []).map((m: any) => [m.id, m.store_name ?? "Store"]),
    );
    const userMap = new Map<string, string | null>(
      (uRes.data ?? []).map((u: any) => [u.id, u.full_name]),
    );
    const courierMap = new Map<string, any>((cRes.data ?? []).map((c: any) => [c.id, c]));

    const eIds = uniq((cRes.data ?? []).map((c: any) => c.assigned_expert_id));
    const expertMap = new Map<string, string>();
    if (eIds.length) {
      const { data: ex, error } = await db.from("experts").select("id, name").in("id", eIds);
      if (error) throw new Error(error.message);
      for (const e of ex ?? []) expertMap.set(e.id, e.name);
    }

    const nowMs = now.getTime();
    const orders: CommerceOrder[] = rows.map((r) => {
      const co = r.courier_order_id ? courierMap.get(r.courier_order_id) : null;
      const pickedUpAt = r.picked_up_at ?? co?.picked_up_at ?? null;
      let riderState: RiderState = "none";
      if (pickedUpAt) riderState = "picked_up";
      else if (co?.assigned_expert_id && co.status !== "SEARCHING" && co.status !== "CANCELLED")
        riderState = "assigned";
      else if (co && ["REQUESTED", "SEARCHING"].includes(co.status)) riderState = "searching";
      else if (r.status === "ready") riderState = "searching";

      const alerts: CommerceAlert[] = [];
      if (r.status === "pending" && minsSince(r.created_at, nowMs) >= MERCHANT_ACCEPT_MIN)
        alerts.push("merchant_slow");
      if (r.status !== "completed" && riderState === "searching") {
        const since = co?.search_started_at ?? r.ready_at;
        if (co?.needs_ops_attention || minsSince(since, nowMs) >= RIDER_SEARCH_MIN)
          alerts.push("no_rider");
      }
      if (
        r.status === "ready" &&
        !pickedUpAt &&
        r.ready_at &&
        minsSince(r.ready_at, nowMs) >= PICKUP_AFTER_READY_MIN
      )
        alerts.push("pickup_delayed");

      return {
        id: r.id,
        orderNumber: r.order_number ?? "",
        status: r.status as CommerceStatus,
        merchantName: merchantMap.get(r.merchant_id) ?? "Store",
        customerName: r.customer_name || userMap.get(r.user_id) || "Customer",
        totalAmount: Number(r.total_amount ?? 0),
        paymentMode: r.payment_mode ?? null,
        paymentStatus: r.payment_status ?? null,
        createdAt: r.created_at,
        acceptedAt: r.accepted_at ?? null,
        readyAt: r.ready_at ?? null,
        pickedUpAt,
        courierOrderId: r.courier_order_id ?? null,
        courierStatus: co?.status ?? null,
        riderName: co?.assigned_expert_id ? expertMap.get(co.assigned_expert_id) ?? null : null,
        riderState,
        alerts,
      };
    });

    const offlineRows = offlineRes.data ?? [];
    return {
      orders,
      offlineToday: {
        count: offlineRows.length,
        revenue: offlineRows.reduce((s: number, r: any) => s + Number(r.total_amount ?? 0), 0),
      },
      canManage,
    };
  });

export type StoreRider = { id: string; name: string; phone: string; distanceKm: number | null };

export const listStoreOrderRiders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<StoreRider[]> => {
    await assertManager(context);
    const db = context.supabase;
    const { data: mo, error } = await db
      .from("merchant_orders")
      .select("courier_order_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    let dist = new Map<string, number>();
    if (mo?.courier_order_id) {
      const { data: el } = await db.rpc("courier_eligible_riders", {
        _order_id: mo.courier_order_id,
        _radius: 15,
      });
      for (const r of (el ?? []) as any[]) dist.set(r.expert_id, Number(r.distance_km));
    }
    let q = db.from("experts").select("id, name, phone").eq("status", "active");
    if (dist.size) q = q.in("id", Array.from(dist.keys()));
    const { data: ex, error: exErr } = await q.order("name").limit(200);
    if (exErr) throw new Error(exErr.message);
    return ((ex ?? []) as any[])
      .map((e) => ({
        id: e.id,
        name: e.name,
        phone: e.phone,
        distanceKm: dist.has(e.id) ? dist.get(e.id)! : null,
      }))
      .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  });

export const reassignStoreRider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; expertId: string }) => {
    if (!input?.orderId || !input?.expertId) throw new Error("orderId and expertId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const { error } = await context.supabase.rpc("staff_reassign_store_rider", {
      _order_id: data.orderId,
      _expert_id: data.expertId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const cancelStoreOrderWithRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; reason: string }) => {
    if (!input?.orderId) throw new Error("orderId required");
    const reason = String(input.reason ?? "").trim().slice(0, 300);
    if (!reason) throw new Error("Reason required");
    return { orderId: input.orderId, reason };
  })
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const db = context.supabase;
    const { data: mo, error } = await db
      .from("merchant_orders")
      .select("id, status, total_amount, razorpay_payment_id, payment_status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!mo) throw new Error("Order not found");
    if (["cancelled", "completed"].includes(mo.status)) throw new Error(`Order is already ${mo.status}`);

    let refundId: string | null = null;
    let refundStatus: string | null = null;
    let refundAmount = 0;
    let refundError: string | null = null;
    const paymentId = mo.razorpay_payment_id as string | null;

    if (paymentId) {
      const keyId = process.env["RAZORPAY_KEY_ID"] || "";
      const secret = process.env["RAZORPAY_KEY_SECRET"] || "";
      if (!keyId || !secret) throw new Error("Payment gateway keys are not configured");
      const auth = "Basic " + btoa(`${keyId}:${secret}`);
      const payRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
        headers: { Authorization: auth },
      });
      const payBody = await payRes.text();
      let pay: any = null;
      try { pay = JSON.parse(payBody); } catch { /* noop */ }
      if (!payRes.ok || !pay) {
        refundStatus = "failed";
        refundError = `Payment lookup failed (${payRes.status})`;
      } else if (pay.status !== "captured") {
        refundStatus = "failed";
        refundError = `Payment not refundable (status ${pay.status})`;
      } else {
        const available = Math.max(0, Number(pay.amount) - Number(pay.amount_refunded ?? 0));
        if (available <= 0) {
          refundStatus = "failed";
          refundError = "Nothing left to refund";
        } else {
          const rRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
            method: "POST",
            headers: { Authorization: auth, "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: available,
              speed: "normal",
              notes: { merchant_order_id: mo.id, source: "admin_cancel" },
            }),
          });
          const rBody = await rRes.text();
          let r: any = null;
          try { r = JSON.parse(rBody); } catch { /* noop */ }
          if (rRes.ok && r?.id) {
            refundId = r.id;
            refundStatus = r.status ?? "processed";
            refundAmount = available / 100;
          } else {
            refundStatus = "failed";
            refundError = r?.error?.description ?? `Refund failed (${rRes.status})`;
          }
        }
      }
    }

    const { error: applyErr } = await db.rpc("staff_cancel_store_order_apply", {
      _order_id: mo.id,
      _reason: data.reason,
      _refund_id: refundId,
      _refund_status: refundStatus,
      _refund_amount: refundAmount,
    });
    if (applyErr) throw new Error(applyErr.message);
    return { ok: true as const, refundAmount, refundStatus, refundError, paid: !!paymentId };
  });
