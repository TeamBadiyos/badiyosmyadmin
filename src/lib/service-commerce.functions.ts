import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Shared Store / Food Command Center data layer. Every query is scoped to one
// service (merchants.service_type) so Food never sees Store data and vice-versa.
// Only existing backend RPCs / RLS-permitted writes are used here.

export type Svc = "store" | "food";
type Ctx = { supabase: any; userId: string };

const svcOk = (s: unknown): Svc => (s === "food" ? "food" : "store");

function scopeMerchants(q: any, svc: Svc) {
  return svc === "food" ? q.eq("service_type", "food") : q.or("service_type.is.null,service_type.neq.food");
}

async function serviceMerchantIds(db: any, svc: Svc): Promise<string[]> {
  const { data, error } = await scopeMerchants(db.from("merchants").select("id").is("deleted_at", null), svc);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m: any) => m.id);
}

async function assertStoreInService(db: any, storeId: string, svc: Svc) {
  const { data, error } = await db.from("merchants").select("id, service_type").eq("id", storeId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Store not found");
  const s: Svc = data.service_type === "food" ? "food" : "store";
  if (s !== svc) throw new Error("This store belongs to another service");
}

function friendly(msg: string) {
  if (msg.includes("MAX_6")) return "You can pick at most 6 recommended items.";
  if (msg.includes("offer_text_too_long")) return "Offer line can be at most 60 characters.";
  if (msg.includes("invalid_category")) return "Pick a category from this service.";
  if (msg.includes("FORBIDDEN") || msg.includes("insufficient_role")) return "You don't have permission for this.";
  if (msg.includes("row-level security")) return "Only super admin can change this.";
  return msg;
}
const chk = (r: { error: any }) => {
  if (r.error) throw new Error(friendly(r.error.message));
};

async function audit(ctx: Ctx, action: string, table: string, id: string | null, before: unknown, after: unknown) {
  await ctx.supabase.from("audit_logs").insert({
    actor_id: ctx.userId, action, target_table: table, target_id: id, before_state: before ?? null, after_state: after ?? null,
  });
}

/* ---------------- Orders ---------------- */

export const listServiceOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; status?: string | null; q?: string; from?: string | null; to?: string | null }) => ({
    service: svcOk(i?.service), status: i?.status || null, q: String(i?.q ?? "").trim().slice(0, 40),
    from: i?.from || null, to: i?.to || null,
  }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ids = await serviceMerchantIds(db, data.service);
    if (!ids.length) return [];
    let q = db.from("merchant_orders")
      .select("id, order_number, status, merchant_id, customer_name, customer_phone, total_amount, total_payable, payment_mode, payment_status, created_at, courier_order_id, refund_status")
      .in("merchant_id", ids).eq("is_training", false)
      .or("payment_mode.neq.online,payment_status.eq.paid")
      .order("created_at", { ascending: false }).limit(300);
    if (data.status) q = q.eq("status", data.status);
    if (data.q) q = q.or(`order_number.ilike.%${data.q.replace(/[,()%]/g, "")}%,customer_phone.ilike.%${data.q.replace(/[,()%]/g, "")}%`);
    if (data.from) q = q.gte("created_at", new Date(data.from + "T00:00:00+05:30").toISOString());
    if (data.to) q = q.lte("created_at", new Date(data.to + "T23:59:59+05:30").toISOString());
    const r = await q; chk(r);
    const rows = r.data ?? [];
    const mIds = Array.from(new Set(rows.map((x: any) => x.merchant_id)));
    const ms = mIds.length ? await db.from("merchants").select("id, store_name").in("id", mIds) : { data: [] };
    const name = new Map((ms.data ?? []).map((m: any) => [m.id, m.store_name]));
    return rows.map((x: any) => ({ ...x, store_name: name.get(x.merchant_id) ?? "—" }));
  });

export const getServiceOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; service: Svc }) => ({ id: String(i.id), service: svcOk(i.service) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const o = await db.from("merchant_orders").select("*").eq("id", data.id).maybeSingle(); chk(o);
    if (!o.data) throw new Error("Order not found");
    await assertStoreInService(db, o.data.merchant_id, data.service);
    const [items, store, courier] = await Promise.all([
      db.from("merchant_order_items").select("*").eq("order_id", data.id),
      db.from("merchants").select("id, store_name, phone, address").eq("id", o.data.merchant_id).maybeSingle(),
      o.data.courier_order_id
        ? db.from("courier_orders").select("id, status, assigned_expert_id").eq("id", o.data.courier_order_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    let rider: { name: string; phone: string } | null = null;
    const eid = (courier as any).data?.assigned_expert_id;
    if (eid) {
      const e = await db.from("experts").select("name, phone").eq("id", eid).maybeSingle();
      rider = e.data ?? null;
    }
    return { order: o.data, items: items.data ?? [], store: store.data, courier: (courier as any).data, rider };
  });

/* ---------------- Stores ---------------- */

export const listServiceStores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc }) => ({ service: svcOk(i?.service) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const r = await scopeMerchants(
      db.from("merchants").select("id, store_name, owner_name, phone, city, status, is_open, rating_avg, rating_count, commission_pct").is("deleted_at", null),
      data.service,
    ).order("store_name"); chk(r);
    const rows = r.data ?? [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const counts = new Map<string, number>();
    if (rows.length) {
      const o = await db.from("merchant_orders").select("merchant_id").in("merchant_id", rows.map((x: any) => x.id))
        .eq("is_training", false).gte("created_at", start.toISOString()).or("payment_mode.neq.online,payment_status.eq.paid").limit(5000);
      for (const x of o.data ?? []) counts.set(x.merchant_id, (counts.get(x.merchant_id) ?? 0) + 1);
    }
    return rows.map((x: any) => ({ ...x, today_orders: counts.get(x.id) ?? 0 }));
  });

export const getStoreDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { storeId: string; service: Svc }) => ({ storeId: String(i.storeId), service: svcOk(i.service) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertStoreInService(db, data.storeId, data.service);
    const [m, cats, order, prods, staff, setl] = await Promise.all([
      db.from("merchants").select("*").eq("id", data.storeId).maybeSingle(),
      db.from("catalog_categories").select("id, name, sort_order, is_active").eq("service_type", data.service).order("sort_order"),
      db.from("store_category_order").select("category_id, sort_order").eq("store_id", data.storeId),
      db.from("products").select("id, name, description, price, image_path, image_url, category_id, is_available, is_active, sort_order, is_recommended, recommended_order, approval_status, pending_changes")
        .eq("merchant_id", data.storeId).order("sort_order", { ascending: true, nullsFirst: false }).limit(1000),
      db.from("merchant_staff").select("id, name, phone, status, created_at").eq("merchant_id", data.storeId),
      db.from("merchant_settlements").select("id, type, period_from, period_to, gross_amount, net_amount, instant_fee, adjustment_total, status, paid_at, invoice_no, created_at")
        .eq("store_id", data.storeId).order("created_at", { ascending: false }).limit(100),
    ]);
    chk(m);
    const pIds = (prods.data ?? []).map((p: any) => p.id);
    const [vars, adds] = pIds.length
      ? await Promise.all([
          db.from("product_variants").select("*").in("product_id", pIds).order("sort_order"),
          db.from("product_addons").select("*").in("product_id", pIds).order("sort_order"),
        ])
      : [{ data: [] }, { data: [] }];
    const byP = (rows: any[]) => {
      const mp = new Map<string, any[]>();
      for (const r of rows ?? []) mp.set(r.product_id, [...(mp.get(r.product_id) ?? []), r]);
      return mp;
    };
    const vm = byP(vars.data as any[]), am = byP(adds.data as any[]);
    const so = new Map((order.data ?? []).map((x: any) => [x.category_id, x.sort_order]));
    const categories = ((cats.data ?? []) as any[])
      .map((c) => ({ ...c, store_order: so.get(c.id) ?? 1000 + (c.sort_order ?? 0) }))
      .sort((a, b) => a.store_order - b.store_order);
    return {
      store: m.data,
      categories,
      products: ((prods.data ?? []) as any[]).map((p) => ({ ...p, variants: vm.get(p.id) ?? [], addons: am.get(p.id) ?? [] })),
      staff: [
        ...(m.data ? [{ id: "owner", name: m.data.owner_name, phone: m.data.phone, status: "active", role: "Owner" }] : []),
        ...((staff.data ?? []) as any[]).map((s) => ({ ...s, role: "Staff" })),
      ],
      settlements: setl.data ?? [],
    };
  });

type StoreAct =
  | { kind: "open"; value: boolean }
  | { kind: "offer"; text: string | null }
  | { kind: "approve" }
  | { kind: "suspend"; reason: string }
  | { kind: "commercials"; commission_pct: number; instant_settlement_fee_pct: number; accept_timeout_minutes: number | null }
  | { kind: "reorderCategories"; ids: string[] }
  | { kind: "reorderProducts"; categoryId: string | null; ids: string[] }
  | { kind: "recommended"; ids: string[] }
  | { kind: "availability"; productId: string; value: boolean }
  | { kind: "upsertProduct"; productId: string | null; payload: Record<string, unknown> };

export const storeAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { storeId: string; service: Svc; act: StoreAct }) => ({ storeId: String(i.storeId), service: svcOk(i.service), act: i.act }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    await assertStoreInService(db, data.storeId, data.service);
    const a = data.act; const sid = data.storeId;
    switch (a.kind) {
      case "open": chk(await (db.rpc as any)("set_store_open", { _store_id: sid, _is_open: !!a.value })); break;
      case "offer": {
        const t = a.text?.trim() || null;
        if (t && t.length > 60) throw new Error("Offer line can be at most 60 characters.");
        chk(await (db.rpc as any)("set_offer_text", { _store_id: sid, _text: t })); break;
      }
      case "approve": chk(await (db.rpc as any)("staff_decide_merchant", { _merchant_id: sid, _decision: "approved", _notes: null })); break;
      case "suspend": {
        const reason = String(a.reason ?? "").trim();
        if (!reason) throw new Error("Reason required");
        const b = await db.from("merchants").select("status").eq("id", sid).maybeSingle();
        chk(await db.from("merchants").update({ status: "suspended" }).eq("id", sid));
        await audit(context, "merchant_suspended", "merchants", sid, b.data, { status: "suspended", reason });
        break;
      }
      case "commercials": {
        const c = Number(a.commission_pct), f = Number(a.instant_settlement_fee_pct);
        const t = a.accept_timeout_minutes == null ? null : Math.round(Number(a.accept_timeout_minutes));
        if (!(c >= 0 && c <= 100) || !(f >= 0 && f <= 100) || (t != null && !(t >= 1 && t <= 120))) throw new Error("Check the values");
        const b = await db.from("merchants").select("commission_pct, instant_settlement_fee_pct, accept_timeout_minutes").eq("id", sid).maybeSingle();
        const after = { commission_pct: c, instant_settlement_fee_pct: f, accept_timeout_minutes: t };
        chk(await db.from("merchants").update(after).eq("id", sid));
        await audit(context, "merchant_commercials_updated", "merchants", sid, b.data, after);
        break;
      }
      case "reorderCategories": chk(await (db.rpc as any)("reorder_store_categories", { _store_id: sid, _category_ids: a.ids })); break;
      case "reorderProducts": chk(await (db.rpc as any)("reorder_products", { _store_id: sid, _category_id: a.categoryId, _product_ids: a.ids })); break;
      case "recommended": chk(await (db.rpc as any)("set_recommended_products", { _store_id: sid, _product_ids: a.ids })); break;
      case "availability": chk(await (db.rpc as any)("set_product_availability", { _product_id: a.productId, _is_available: !!a.value })); break;
      case "upsertProduct": chk(await (db.rpc as any)("staff_upsert_product", { _store_id: sid, _payload: a.payload, _product_id: a.productId })); break;
    }
    return { ok: true as const };
  });

/* ---------------- Approvals ---------------- */

export const listProductApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc }) => ({ service: svcOk(i?.service) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const ms = await scopeMerchants(db.from("merchants").select("id, store_name").is("deleted_at", null), data.service);
    chk(ms);
    const ids = (ms.data ?? []).map((m: any) => m.id);
    if (!ids.length) return { stores: [], categories: [] };
    const p = await db.from("products")
      .select("id, merchant_id, name, description, price, image_path, image_url, category_id, approval_status, pending_changes, pending_submitted_at")
      .in("merchant_id", ids).or("pending_changes.not.is.null,approval_status.eq.pending").limit(500);
    chk(p);
    const rows = (p.data ?? []) as any[];
    const pIds = rows.map((r) => r.id);
    const [v, ad, cats] = await Promise.all([
      pIds.length ? db.from("product_variants").select("product_id, name, price").in("product_id", pIds).order("sort_order") : { data: [] },
      pIds.length ? db.from("product_addons").select("product_id, name, price").in("product_id", pIds).order("sort_order") : { data: [] },
      db.from("catalog_categories").select("id, name").eq("service_type", data.service),
    ]);
    const name = new Map((ms.data ?? []).map((m: any) => [m.id, m.store_name]));
    const group = new Map<string, any>();
    for (const r of rows) {
      const g = group.get(r.merchant_id) ?? { storeId: r.merchant_id, storeName: name.get(r.merchant_id), products: [] };
      g.products.push({
        ...r,
        variants: ((v as any).data ?? []).filter((x: any) => x.product_id === r.id),
        addons: ((ad as any).data ?? []).filter((x: any) => x.product_id === r.id),
      });
      group.set(r.merchant_id, g);
    }
    return { stores: Array.from(group.values()), categories: (cats as any).data ?? [] };
  });

export const reviewProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { productId: string; approve: boolean; note?: string | null }) => ({
    productId: String(i.productId), approve: !!i.approve, note: i.note?.trim() || null,
  }))
  .handler(async ({ data, context }) => {
    if (!data.approve && !data.note) throw new Error("Please add a note when rejecting.");
    chk(await (context.supabase.rpc as any)("staff_review_product_changes", { _product_id: data.productId, _approve: data.approve, _note: data.note }));
    return { ok: true as const };
  });

/* ---------------- Categories ---------------- */

export const listCatalogCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc }) => ({ service: svcOk(i?.service) }))
  .handler(async ({ data, context }) => {
    const r = await context.supabase.from("catalog_categories").select("*").eq("service_type", data.service).order("sort_order");
    chk(r);
    return r.data ?? [];
  });

export const saveCatalogCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; id?: string | null; name: string; image_path?: string | null; is_active: boolean }) => ({
    service: svcOk(i.service), id: i.id || null, name: String(i.name ?? "").trim().slice(0, 60),
    image_path: i.image_path || null, is_active: !!i.is_active,
  }))
  .handler(async ({ data, context }) => {
    if (!data.name) throw new Error("Name required");
    const db = context.supabase;
    if (data.id) {
      const b = await db.from("catalog_categories").select("*").eq("id", data.id).eq("service_type", data.service).maybeSingle();
      if (!b.data) throw new Error("Category not found");
      chk(await db.from("catalog_categories").update({ name: data.name, image_path: data.image_path, is_active: data.is_active }).eq("id", data.id));
      await audit(context, "catalog_category_updated", "catalog_categories", data.id, b.data, data);
    } else {
      const mx = await db.from("catalog_categories").select("sort_order").eq("service_type", data.service).order("sort_order", { ascending: false }).limit(1);
      const r = await db.from("catalog_categories").insert({
        service_type: data.service, name: data.name, image_path: data.image_path, is_active: data.is_active,
        sort_order: ((mx.data?.[0]?.sort_order as number) ?? 0) + 1,
      }).select("id").single();
      chk(r);
      await audit(context, "catalog_category_created", "catalog_categories", (r.data as any).id, null, data);
    }
    return { ok: true as const };
  });

export const reorderCatalogCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; ids: string[] }) => ({ service: svcOk(i.service), ids: (i.ids ?? []).map(String) }))
  .handler(async ({ data, context }) => {
    for (let k = 0; k < data.ids.length; k++) {
      chk(await context.supabase.from("catalog_categories").update({ sort_order: k + 1 }).eq("id", data.ids[k]).eq("service_type", data.service));
    }
    return { ok: true as const };
  });

/* ---------------- Sponsored ---------------- */

export const listSponsored = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; categoryId: string | null }) => ({ service: svcOk(i.service), categoryId: i.categoryId || null }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    let q = db.from("sponsored_slots").select("*").eq("service_type", data.service).order("position");
    q = data.categoryId ? q.eq("category_id", data.categoryId) : q.is("category_id", null);
    const [slots, stores] = await Promise.all([
      q,
      scopeMerchants(db.from("merchants").select("id, store_name").eq("status", "approved").is("deleted_at", null), data.service).order("store_name"),
    ]);
    chk(slots); chk(stores);
    return { slots: slots.data ?? [], stores: stores.data ?? [] };
  });

export const saveSponsoredSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; id?: string | null; categoryId: string | null; storeId: string; position: number; startsAt: string; endsAt: string; isActive: boolean }) => i)
  .handler(async ({ data, context }) => {
    const svc = svcOk(data.service);
    const db = context.supabase;
    const pos = Math.round(Number(data.position));
    if (!(pos >= 1 && pos <= 6)) throw new Error("Position must be 1–6");
    if (!data.storeId) throw new Error("Pick a store");
    if (!data.startsAt || !data.endsAt || data.endsAt < data.startsAt) throw new Error("Check the dates");
    const st = await db.from("merchants").select("status, service_type").eq("id", data.storeId).maybeSingle();
    if (!st.data || st.data.status !== "approved" || (st.data.service_type === "food" ? "food" : "store") !== svc) throw new Error("Pick an approved store from this service");
    const row = {
      service_type: svc, category_id: data.categoryId || null, store_id: data.storeId, position: pos,
      starts_at: new Date(data.startsAt + "T00:00:00+05:30").toISOString(),
      ends_at: new Date(data.endsAt + "T23:59:59+05:30").toISOString(), is_active: !!data.isActive,
    };
    if (data.id) chk(await db.from("sponsored_slots").update(row).eq("id", data.id).eq("service_type", svc));
    else chk(await db.from("sponsored_slots").insert(row));
    await audit(context, data.id ? "sponsored_slot_updated" : "sponsored_slot_created", "sponsored_slots", data.id ?? null, null, row);
    return { ok: true as const };
  });

export const deleteSponsoredSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; id: string }) => ({ service: svcOk(i.service), id: String(i.id) }))
  .handler(async ({ data, context }) => {
    chk(await context.supabase.from("sponsored_slots").delete().eq("id", data.id).eq("service_type", data.service));
    await audit(context, "sponsored_slot_deleted", "sponsored_slots", data.id, null, null);
    return { ok: true as const };
  });

/* ---------------- Settings ---------------- */

export const getServiceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc }) => ({ service: svcOk(i?.service) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const to = new Date(Date.now() + 5.5 * 3600e3);
    const from = new Date(to.getTime() - 6 * 86400e3);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const [s, n] = await Promise.all([
      db.from("service_settings").select("*").eq("service_key", data.service).maybeSingle(),
      db.rpc("staff_notify_summary", { _from: d(from), _to: d(to) }),
    ]);
    chk(s);
    const rows = ((n.data ?? []) as any[]).filter((r) => r.service_type === data.service);
    const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    return { settings: s.data, notify: { tried: sum("tried"), notified: sum("notified"), converted: sum("converted"), error: n.error?.message ?? null } };
  });

export const saveServiceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: Svc; delivery_min_fare?: number; delivery_per_km?: number; rider_share_pct?: number; default_accept_timeout_minutes: number }) => i)
  .handler(async ({ data, context }) => {
    const svc = svcOk(data.service);
    const patch: Record<string, number> = {};
    const t = Math.round(Number(data.default_accept_timeout_minutes));
    if (!(t >= 1 && t <= 120)) throw new Error("Accept timeout must be 1–120 minutes");
    patch.default_accept_timeout_minutes = t;
    if (svc === "food") {
      const a = Number(data.delivery_min_fare), b = Number(data.delivery_per_km), c = Number(data.rider_share_pct);
      if (!(a >= 0) || !(b >= 0) || !(c >= 0 && c <= 100)) throw new Error("Check the values");
      Object.assign(patch, { delivery_min_fare: a, delivery_per_km: b, rider_share_pct: c });
    }
    const db = context.supabase;
    const b = await db.from("service_settings").select("*").eq("service_key", svc).maybeSingle();
    const r = await db.from("service_settings").update({ ...patch, updated_at: new Date().toISOString(), updated_by: context.userId }).eq("service_key", svc).select("service_key");
    chk(r);
    if (!r.data?.length) throw new Error("Only super admin can change this.");
    await audit(context, "service_settings_updated", "service_settings", null, b.data, { service: svc, ...patch });
    return { ok: true as const };
  });
