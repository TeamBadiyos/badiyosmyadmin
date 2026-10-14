import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireFinance(supabase: { rpc: (n: never) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("is_offer_finance_user" as never);
  if (!data) throw new Error("Only super admin or finance can refund");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireSuperAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("staff_users").select("role, status").eq("auth_user_id", userId).maybeSingle();
  if (!data || data.status !== "active" || data.role !== "super_admin") throw new Error("Forbidden");
}

/** Refund a single paid event-offer redemption (super_admin / finance). */
export const refundOfferRedemption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { redemptionId: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase as never);
    const { refundRedemption } = await import("@/lib/event-offers.server");
    return refundRedemption(data.redemptionId);
  });

/** process_offer_refunds: refund every still-'paid' row of an ended auto_refund offer. */
export const processOfferRefunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offerId: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase as never);
    const { data: rows, error } = await context.supabase.rpc("staff_offer_refundable" as never, { _offer_id: data.offerId } as never);
    if (error) throw new Error(error.message);
    const { refundRedemption } = await import("@/lib/event-offers.server");
    let refunded = 0; const failed: string[] = [];
    for (const r of (rows ?? []) as Array<{ id: string }>) {
      try { const res = await refundRedemption(r.id); if (res.ok) refunded++; else failed.push(r.id); }
      catch { failed.push(r.id); }
    }
    return { refunded, failed };
  });

/* ---------------------------------------------------------------- screen reads */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventOfferRow = Record<string, any> & {
  id: string; title: string; price: number; is_active: boolean; starts_at: string; ends_at: string;
  total_stock: number | null; payment_hold_minutes: number; unredeemed_refund_policy: string; pin_set: boolean;
  counts: { confirmed: number; pending: number; undone: number; paid: number; used: number };
  revenue: number;
};

const OFFER_COLS =
  "id,title,description,rules_text,button_text,success_title,success_message,emoji,image_url,card_color,price,mrp,starts_at,ends_at,is_active,per_user_limit,per_device_limit,total_stock,show_remaining,audience,new_users_since,city_ids,undo_seconds,require_staff_pin,payment_hold_minutes,unredeemed_refund_policy,show_as_home_banner,sort_order,created_at";

function effective(status: string, deadline: string | null) {
  // mirrors event_redemption_effective_status
  if (status === "pending" && (!deadline || new Date(deadline).getTime() <= Date.now())) return "confirmed";
  return status;
}

export const listEventOffers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EventOfferRow[]> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: offers, error } = await supabaseAdmin.from("event_offers" as never)
      .select(OFFER_COLS + ",staff_pin_hash").order("sort_order").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const { data: reds } = await supabaseAdmin.from("event_redemptions" as never)
      .select("offer_id,status,undo_deadline,amount,created_at");
    const rows = (reds ?? []) as Array<{ offer_id: string; status: string; undo_deadline: string | null; amount: number; created_at: string }>;
    return ((offers ?? []) as Array<Record<string, unknown>>).map((o) => {
      const { staff_pin_hash, ...rest } = o;
      const mine = rows.filter((r) => r.offer_id === o.id);
      const c = { confirmed: 0, pending: 0, undone: 0, paid: 0, used: 0 };
      let revenue = 0;
      const hold = Number(o.payment_hold_minutes ?? 10);
      for (const r of mine) {
        const s = effective(r.status, r.undo_deadline);
        if (s === "confirmed") c.confirmed++;
        else if (s === "pending") c.pending++;
        else if (s === "undone") c.undone++;
        else if (s === "paid") c.paid++;
        const counted = s === "payment_pending"
          ? new Date(r.created_at).getTime() > Date.now() - hold * 60000
          : ["paid", "pending", "confirmed"].includes(s);
        if (counted) c.used++;
        if (["paid", "pending", "confirmed"].includes(s)) revenue += r.amount ?? 0;
      }
      return { ...(rest as object), pin_set: !!staff_pin_hash, counts: c, revenue } as EventOfferRow;
    });
  });

export type RedemptionRow = {
  id: string; userId: string; name: string | null; phone: string | null; status: string; amount: number;
  paymentId: string | null; createdAt: string; deviceKey: string | null; samePhone: boolean;
};

export const listOfferRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offerId: string }) => d)
  .handler(async ({ data, context }): Promise<{ rows: RedemptionRow[]; refundable: string[] }> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reds, error } = await supabaseAdmin.from("event_redemptions" as never)
      .select("id,user_id,status,undo_deadline,amount,razorpay_payment_id,created_at,device_key")
      .eq("offer_id", data.offerId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = (reds ?? []) as Array<{ id: string; user_id: string; status: string; undo_deadline: string | null; amount: number; razorpay_payment_id: string | null; created_at: string; device_key: string | null }>;
    const uids = [...new Set(list.map((r) => r.user_id))];
    const { data: users } = uids.length
      ? await supabaseAdmin.from("users").select("id, full_name, phone").in("id", uids)
      : { data: [] };
    const um = new Map(((users ?? []) as Array<{ id: string; full_name: string | null; phone: string | null }>).map((u) => [u.id, u]));
    const devUsers = new Map<string, Set<string>>();
    for (const r of list) if (r.device_key) {
      if (!devUsers.has(r.device_key)) devUsers.set(r.device_key, new Set());
      devUsers.get(r.device_key)!.add(r.user_id);
    }
    const { data: ref } = await context.supabase.rpc("staff_offer_refundable" as never, { _offer_id: data.offerId } as never);
    return {
      rows: list.map((r) => ({
        id: r.id, userId: r.user_id, name: um.get(r.user_id)?.full_name ?? null, phone: um.get(r.user_id)?.phone ?? null,
        status: effective(r.status, r.undo_deadline), amount: r.amount, paymentId: r.razorpay_payment_id,
        createdAt: r.created_at, deviceKey: r.device_key,
        samePhone: !!r.device_key && (devUsers.get(r.device_key)?.size ?? 0) > 1,
      })),
      refundable: ((ref ?? []) as Array<{ id: string }>).map((x) => x.id),
    };
  });

/* ---------------------------------------------------------------- screen writes */

export const upsertEventOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offer: Record<string, unknown> }) => d)
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("staff_upsert_event_offer" as never, { _p: data.offer } as never);
    if (error) throw new Error(error.message);
    return { id: id as unknown as string };
  });

export const setEventOfferPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { offerId: string; pin: string }) => {
    if (!/^\d{4}$/.test(d.pin)) throw new Error("PIN must be exactly 4 digits");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_offer_staff_pin" as never, { p_offer_id: data.offerId, p_pin: data.pin } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
