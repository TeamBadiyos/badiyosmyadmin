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
  status: string; is_test: boolean; pin_status: string; delivered_at: string | null; fail_reason: string | null; courier_order_id: string | null;
};
export type GiftTrip = { id: string; trip_no: number; zone_name: string | null; distance_km: number | null; status: string; route_source: string; courier_order_id: string | null; fail_reason: string | null; sent_at: string | null };

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
      c.supabase.from("gift_drops").select("id, recipient_name, recipient_phone, address, lat, lng, zone_name, gift_note, packet_count, trip_id, stop_seq, status, is_test, pin_status, delivered_at, fail_reason, courier_order_id").eq("campaign_id", i.id).order("stop_seq").limit(5000),
      c.supabase.from("gift_trips").select("id, trip_no, zone_name, distance_km, status, route_source, courier_order_id, fail_reason, sent_at").eq("campaign_id", i.id).order("trip_no"),
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

/* ---------------------------- finishing pieces ---------------------------- */

type LatLng = { lat: number; lng: number };

async function geocodeOne(address: string): Promise<LatLng | null> {
  const lov = process.env.LOVABLE_API_KEY;
  const gm = process.env.GOOGLE_MAPS_API_KEY;
  if (!lov || !gm) throw new Error("Address lookup needs the Google Maps connection");
  const r = await fetch(
    `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?region=in&components=country:IN&address=${encodeURIComponent(address)}`,
    { headers: { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": gm } },
  );
  if (!r.ok) {
    const t = await r.text();
    console.error(`Geocode failed [${r.status}]: ${t}`);
    if (r.status === 403) throw new Error("Google Maps key does not allow address lookup (Geocoding API)");
    return null;
  }
  const j = await r.json();
  const loc = j?.results?.[0]?.geometry?.location;
  return loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lng: loc.lng } : null;
}

/** Address search for the pin picker (bounded: one lookup per call). */
export const geocodeAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { q: string }) => {
    const q = String(i?.q ?? "").trim();
    if (q.length < 3 || q.length > 300) throw new Error("Type an address");
    return { q };
  })
  .handler(async ({ data, context }) => { await requireOps(context as Ctx); return geocodeOne(data.q); });

export type DropInput2 = Omit<DropInput, "lat" | "lng"> & { lat?: number | null; lng?: number | null; save_client?: boolean; client_id?: string | null; address_id?: string | null };

/** Adds drops; rows without a pin are looked up by address (max 300 lookups per import). */
export const addGiftDropsV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string; drops: DropInput2[] }) => {
    if (!i?.campaign_id || !Array.isArray(i.drops) || !i.drops.length) throw new Error("No drops to add");
    if (i.drops.length > 2000) throw new Error("Max 2000 drops at a time");
    for (const d of i.drops) {
      if (!d.recipient_name?.trim() || !d.address?.trim()) throw new Error("Every row needs name and address");
      const has = d.lat != null && d.lng != null && String(d.lat) !== "" && String(d.lng) !== "";
      if (has && (!Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lng)) || Math.abs(Number(d.lat)) > 90 || Math.abs(Number(d.lng)) > 180))
        throw new Error(`Invalid location for ${d.recipient_name}`);
    }
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data: camp, error: e1 } = await c.supabase.from("gift_campaigns").select("merchant_id, city_id").eq("id", i.campaign_id).single();
    if (e1) throw new Error(e1.message);
    const needLookup = i.drops.filter((d) => d.lat == null || d.lng == null || String(d.lat) === "").length;
    if (needLookup > 300) throw new Error("Max 300 rows without lat/lng per import (address lookups are paid)");
    const cache = new Map<string, LatLng | null>();
    let looked = 0, missing = 0;
    const rows: any[] = [];
    for (const d of i.drops) {
      let lat = d.lat != null && String(d.lat) !== "" ? Number(d.lat) : null;
      let lng = d.lng != null && String(d.lng) !== "" ? Number(d.lng) : null;
      let pin = "ok";
      if (lat == null || lng == null) {
        const key = d.address.trim().toLowerCase();
        if (!cache.has(key)) cache.set(key, await geocodeOne(d.address.trim()));
        const g = cache.get(key);
        looked++;
        if (g) { lat = g.lat; lng = g.lng; pin = "to_confirm"; } else { pin = "missing"; missing++; }
      }
      let client_id = d.client_id ?? null, address_id = d.address_id ?? null;
      if (!client_id && d.save_client !== false) {
        const { data: cl } = await c.supabase.from("gift_clients").insert({ merchant_id: camp.merchant_id, city_id: camp.city_id, name: d.recipient_name.trim(), phone: d.recipient_phone?.trim() || null }).select("id").single();
        if (cl) {
          client_id = cl.id;
          if (lat != null) {
            const { data: ad } = await c.supabase.from("gift_client_addresses").insert({ client_id: cl.id, merchant_id: camp.merchant_id, address: d.address.trim(), lat, lng, is_default: true }).select("id").single();
            address_id = ad?.id ?? null;
          }
        }
      }
      rows.push({ campaign_id: i.campaign_id, merchant_id: camp.merchant_id, client_id, address_id, recipient_name: d.recipient_name.trim(),
        recipient_phone: d.recipient_phone?.trim() || null, address: d.address.trim(), lat, lng, pin_status: pin,
        gift_note: d.gift_note?.trim() || null, packet_count: Math.max(1, Number(d.packet_count) || 1) });
    }
    const { error } = await c.supabase.from("gift_drops").insert(rows);
    if (error) throw new Error(error.message);
    await c.supabase.rpc("business_audit", { _action: "gift_drops_add", _table: "gift_campaigns", _id: i.campaign_id, _before: null, _after: { count: rows.length, looked_up: looked, missing }, _actor_label: null });
    return { added: rows.length, lookedUp: looked, missing };
  });

export type GiftClient = { id: string; name: string; phone: string | null; company: string | null; is_test: boolean;
  addresses: { id: string; label: string; address: string; lat: number; lng: number; is_default: boolean }[] };

export const listGiftClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string }) => i)
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const [cl, ad] = await Promise.all([
      c.supabase.from("gift_clients").select("id, name, phone, company, is_test").eq("merchant_id", i.merchant_id).order("name").limit(5000),
      c.supabase.from("gift_client_addresses").select("id, client_id, label, address, lat, lng, is_default").eq("merchant_id", i.merchant_id).limit(10000),
    ]);
    if (cl.error) throw new Error(cl.error.message);
    const by = new Map<string, any[]>();
    for (const a of (ad.data ?? []) as any[]) { const l = by.get(a.client_id) ?? []; l.push(a); by.set(a.client_id, l); }
    return ((cl.data ?? []) as any[]).map((x) => ({ ...x, addresses: (by.get(x.id) ?? []).sort((a, b) => Number(b.is_default) - Number(a.is_default)) })) as GiftClient[];
  });

export const setGiftPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { drop_id: string; lat: number; lng: number }) => i)
  .handler(async ({ data: i, context }) => { await rpc(context as Ctx, "gift_set_pin", { _drop: i.drop_id, _lat: i.lat, _lng: i.lng }); return { ok: true }; });

/** Campaign pickup; optionally also saved as the business's default pickup point. */
export const saveGiftPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string; name: string; address: string; lat: number; lng: number; contact?: string; as_default: boolean }) => {
    if (!i?.address?.trim() || !Number.isFinite(i.lat) || !Number.isFinite(i.lng)) throw new Error("Address and pin are required");
    return i;
  })
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data: camp, error } = await c.supabase.from("gift_campaigns").select("merchant_id").eq("id", i.campaign_id).single();
    if (error) throw new Error(error.message);
    const pid = await rpc(c, "staff_upsert_pickup_point", { _merchant_id: camp.merchant_id, _id: null, _name: i.name || "Pickup", _address: i.address.trim(),
      _lat: i.lat, _lng: i.lng, _contact_name: null, _contact_phone: i.contact || null, _is_default: i.as_default, _is_active: true });
    const { error: e2 } = await c.supabase.from("gift_campaigns").update({ pickup_name: i.name || "Pickup", pickup_address: i.address.trim(), pickup_lat: i.lat, pickup_lng: i.lng,
      pickup_contact: i.contact || null, pickup_point_id: typeof pid === "string" ? pid : null }).eq("id", i.campaign_id);
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });

export const sendGiftTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { trip_id: string; expert_id?: string | null; training?: boolean }) => i)
  .handler(async ({ data: i, context }) => rpc(context as Ctx, "gift_send_trip", { _trip: i.trip_id, _expert: i.expert_id ?? null, _training: !!i.training }) as Promise<{ ok: boolean; courier_order_id: string; total: number }>);

export const sendAllGiftTrips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string }) => i)
  .handler(async ({ data: i, context }) => rpc(context as Ctx, "gift_send_all", { _campaign: i.campaign_id }) as Promise<{ sent: number; errors: { trip: number; error: string }[] }>);

export const retryGiftDrops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string; drop_ids: string[] }) => i)
  .handler(async ({ data: i, context }) => rpc(context as Ctx, "gift_retry_drops", { _campaign: i.campaign_id, _drop_ids: i.drop_ids }) as Promise<{ trip_no: number; drops: number }>);

export const listGiftRiders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data, error } = await c.supabase.from("experts").select("id, name, mode").eq("status", "active").order("name").limit(2000);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string; mode: string | null }[];
  });

export type GiftProof = { drop_id: string; kind: string; url: string; captured_at: string; distance_m: number | null };

/** Delivered / not-delivered photos for a campaign (signed for 1 hour). */
export const getGiftProofs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { campaign_id: string }) => i)
  .handler(async ({ data: i, context }) => {
    const c = context as Ctx; await requireOps(c);
    const { data: drops } = await c.supabase.from("gift_drops").select("id, business_order_id").eq("campaign_id", i.campaign_id).not("business_order_id", "is", null).limit(5000);
    const boIds = ((drops ?? []) as any[]).map((d) => d.business_order_id);
    if (!boIds.length) return [] as GiftProof[];
    const { data: bos } = await c.supabase.from("business_orders").select("id, drop_stop_id").in("id", boIds);
    const stopToDrop = new Map<string, string>();
    for (const b of (bos ?? []) as any[]) { const d = (drops as any[]).find((x) => x.business_order_id === b.id); if (b.drop_stop_id && d) stopToDrop.set(b.drop_stop_id, d.id); }
    if (!stopToDrop.size) return [] as GiftProof[];
    const { data: pr } = await c.supabase.from("business_delivery_proofs").select("stop_id, storage_path, kind, captured_at, distance_from_pin_m").in("stop_id", [...stopToDrop.keys()]);
    const rows = (pr ?? []) as any[];
    if (!rows.length) return [] as GiftProof[];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed } = await supabaseAdmin.storage.from("delivery-proofs").createSignedUrls(rows.map((r) => r.storage_path), 3600);
    return rows.map((r, k) => ({ drop_id: stopToDrop.get(r.stop_id)!, kind: r.kind ?? "delivered", url: signed?.[k]?.signedUrl ?? "",
      captured_at: r.captured_at, distance_m: r.distance_from_pin_m })) as GiftProof[];
  });
