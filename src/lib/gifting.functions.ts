import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = { supabase: any; userId: string };

async function requireOps(context: Ctx) {
  const { data, error } = await context.supabase
    .from("staff_users").select("role, status").eq("auth_user_id", context.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) throw new Error("Forbidden");
}
async function rpc(context: Ctx, name: string, args: Record<string, unknown>) {
  await requireOps(context);
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export type GiftCampaign = {
  id: string; merchant_id: string; name: string; occasion: string | null; status: string; is_test: boolean;
  pickup_name: string | null; pickup_address: string | null; pickup_lat: number | null; pickup_lng: number | null;
  pickup_date: string | null; max_drops_per_trip: number; business_name: string; drops: number; trips: number;
};
export type GiftDrop = {
  id: string; recipient_name: string; recipient_phone: string | null; address: string; lat: number; lng: number;
  zone_name: string | null; gift_note: string | null; packet_count: number; trip_id: string | null; stop_seq: number | null;
  status: string; is_test: boolean;
};
export type GiftTrip = { id: string; trip_no: number; zone_name: string | null; distance_km: number | null; status: string; route_source: string };

export const listGiftCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data, error } = await c.supabase.from("gift_campaigns").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    const mids = [...new Set(rows.map((r) => r.merchant_id))];
    const ids = rows.map((r) => r.id);
    const [bp, dr, tr] = await Promise.all([
      mids.length ? c.supabase.from("business_profiles").select("merchant_id, business_name").in("merchant_id", mids) : { data: [] },
      ids.length ? c.supabase.from("gift_drops").select("campaign_id").in("campaign_id", ids).limit(10000) : { data: [] },
      ids.length ? c.supabase.from("gift_trips").select("campaign_id").in("campaign_id", ids).limit(5000) : { data: [] },
    ]);
    const name = new Map(((bp as any).data ?? []).map((b: any) => [b.merchant_id, b.business_name]));
    const count = (arr: any[], id: string) => arr.filter((x) => x.campaign_id === id).length;
    return rows.map((r) => ({ ...r, business_name: (name.get(r.merchant_id) as string) ?? "—",
      drops: count((dr as any).data ?? [], r.id), trips: count((tr as any).data ?? [], r.id) })) as GiftCampaign[];
  });

export const listGiftBusinesses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data, error } = await c.supabase.from("business_profiles").select("merchant_id, business_name, city").order("business_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as { merchant_id: string; business_name: string; city: string | null }[];
  });

export const getGiftCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const [d, t] = await Promise.all([
      c.supabase.from("gift_drops").select("id, recipient_name, recipient_phone, address, lat, lng, zone_name, gift_note, packet_count, trip_id, stop_seq, status, is_test").eq("campaign_id", i.id).order("stop_seq").limit(5000),
      c.supabase.from("gift_trips").select("id, trip_no, zone_name, distance_km, status, route_source").eq("campaign_id", i.id).order("trip_no"),
    ]);
    if (d.error) throw new Error(d.error.message);
    if (t.error) throw new Error(t.error.message);
    return { drops: (d.data ?? []) as GiftDrop[], trips: (t.data ?? []) as GiftTrip[] };
  });

export const saveGiftCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id?: string; merchant_id: string; name: string; occasion?: string; pickup_name?: string; pickup_address?: string; pickup_lat?: number | null; pickup_lng?: number | null; pickup_date?: string | null; max_drops_per_trip?: number }) => {
    if (!i?.merchant_id || !i.name?.trim()) throw new Error("Business and campaign name are required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const row = { merchant_id: i.merchant_id, name: i.name.trim(), occasion: i.occasion || null, pickup_name: i.pickup_name || null,
      pickup_address: i.pickup_address || null, pickup_lat: i.pickup_lat ?? null, pickup_lng: i.pickup_lng ?? null,
      pickup_date: i.pickup_date || null, max_drops_per_trip: Math.max(1, Number(i.max_drops_per_trip) || 12), created_by: c.userId };
    const q = i.id ? c.supabase.from("gift_campaigns").update(row).eq("id", i.id).select("id").single()
      : c.supabase.from("gift_campaigns").insert(row).select("id").single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    await c.supabase.rpc("business_audit", { _action: i.id ? "gift_campaign_update" : "gift_campaign_create", _table: "gift_campaigns", _id: data.id, _before: null, _after: row, _actor_label: null });
    return { id: data.id as string };
  });

export type DropInput = { recipient_name: string; recipient_phone?: string; address: string; lat: number; lng: number; gift_note?: string; packet_count?: number };

export const addGiftDrops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string; drops: DropInput[] }) => {
    if (!i?.campaign_id || !Array.isArray(i.drops) || !i.drops.length) throw new Error("No drops to add");
    if (i.drops.length > 2000) throw new Error("Max 2000 drops at a time");
    for (const d of i.drops) {
      if (!d.recipient_name?.trim() || !d.address?.trim()) throw new Error("Every row needs name and address");
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng) || Math.abs(d.lat) > 90 || Math.abs(d.lng) > 180) throw new Error(`Invalid location for ${d.recipient_name}`);
    }
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data: camp, error: e1 } = await c.supabase.from("gift_campaigns").select("merchant_id, city_id").eq("id", i.campaign_id).single();
    if (e1) throw new Error(e1.message);
    const rows = i.drops.map((d) => ({ campaign_id: i.campaign_id, merchant_id: camp.merchant_id, recipient_name: d.recipient_name.trim(),
      recipient_phone: d.recipient_phone?.trim() || null, address: d.address.trim(), lat: d.lat, lng: d.lng,
      gift_note: d.gift_note?.trim() || null, packet_count: Math.max(1, Number(d.packet_count) || 1) }));
    // Save recipients to the business's client list (multi-address) too
    for (const r of rows) {
      const { data: cl } = await c.supabase.from("gift_clients").insert({ merchant_id: camp.merchant_id, city_id: camp.city_id, name: r.recipient_name, phone: r.recipient_phone }).select("id").single();
      if (cl) {
        const { data: ad } = await c.supabase.from("gift_client_addresses").insert({ client_id: cl.id, merchant_id: camp.merchant_id, address: r.address, lat: r.lat, lng: r.lng, is_default: true }).select("id").single();
        Object.assign(r, { client_id: cl.id, address_id: ad?.id ?? null });
      }
    }
    const { error } = await c.supabase.from("gift_drops").insert(rows);
    if (error) throw new Error(error.message);
    await c.supabase.rpc("business_audit", { _action: "gift_drops_add", _table: "gift_campaigns", _id: i.campaign_id, _before: null, _after: { count: rows.length }, _actor_label: null });
    return { added: rows.length };
  });

export const deleteGiftDrop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data: d } = await c.supabase.from("gift_drops").select("*").eq("id", i.id).single();
    const { error } = await c.supabase.from("gift_drops").delete().eq("id", i.id).in("status", ["pending", "planned"]);
    if (error) throw new Error(error.message);
    await c.supabase.rpc("business_audit", { _action: "gift_drop_delete", _table: "gift_drops", _id: i.id, _before: d, _after: null, _actor_label: null });
    return { ok: true };
  });

export const planGiftTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string }) => i)
  .handler(async ({ data: i, context }) => rpc(context as Ctx, "gift_plan_trips", { _campaign: i.campaign_id }) as Promise<{ trips: number }>);

export const moveGiftDrop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { drop_id: string; trip_id: string }) => i)
  .handler(async ({ data: i, context }) => { await rpc(context as Ctx, "gift_move_drop", { _drop: i.drop_id, _to_trip: i.trip_id }); return { ok: true }; });

export const setGiftTripOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { trip_id: string; drop_ids: string[] }) => i)
  .handler(async ({ data: i, context }) => { await rpc(context as Ctx, "gift_set_trip_order", { _trip: i.trip_id, _drop_ids: i.drop_ids }); return { ok: true }; });

export const deleteGiftTestData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string }) => i)
  .handler(async ({ data: i, context }) => rpc(context as Ctx, "gift_delete_test_data", { _campaign: i.campaign_id }) as Promise<{ drops: number; clients: number; campaign_deleted: boolean }>);
