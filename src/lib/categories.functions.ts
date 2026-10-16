import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CatKind = "store_type" | "store_product" | "food";
const kindOk = (k: unknown): CatKind => {
  if (k === "store_type" || k === "store_product" || k === "food") return k;
  throw new Error("Bad kind");
};
const cityOk = (c: unknown) => (typeof c === "string" && /^[0-9a-f-]{36}$/i.test(c) ? c : null);
const fail = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

/** List for one city (its own list if it has one, otherwise the Default list). */
export const listCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: CatKind; cityId?: string | null }) => ({ kind: kindOk(i?.kind), cityId: cityOk(i?.cityId) }))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const isType = data.kind === "store_type";
    const base = () => {
      const q = db.from(isType ? "store_categories" : "catalog_categories").select("*");
      return isType ? q : q.eq("service_type", data.kind === "food" ? "food" : "store");
    };
    let hasCity = false;
    let rows: any[] = [];
    if (data.cityId) {
      const r = await base().eq("city_id", data.cityId).order("sort_order");
      fail(r); rows = r.data ?? []; hasCity = rows.length > 0;
    }
    if (!hasCity) { const r = await base().is("city_id", null).order("sort_order"); fail(r); rows = r.data ?? []; }
    rows.sort((a, b) => Number(a.is_other) - Number(b.is_other) || a.sort_order - b.sort_order);
    const ids = rows.map((r) => r.id);
    const count: Record<string, number> = {};
    if (ids.length) {
      const u = isType
        ? await db.from("merchants").select("store_category_id").in("store_category_id", ids).is("deleted_at", null).limit(5000)
        : await db.from("products").select("category_id").in("category_id", ids).limit(10000);
      for (const x of u.data ?? []) { const k = isType ? x.store_category_id : x.category_id; count[k] = (count[k] ?? 0) + 1; }
    }
    return { hasCityList: hasCity, rows: rows.map((r) => ({ ...r, used: count[r.id] ?? 0 })) };
  });

export const saveCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: CatKind; id?: string | null; cityId?: string | null; name: string; name_mr: string; image_path?: string | null; is_active: boolean }) => ({
    kind: kindOk(i.kind), id: i.id || null, cityId: cityOk(i.cityId),
    name: String(i.name ?? "").trim().slice(0, 60), name_mr: String(i.name_mr ?? "").trim().slice(0, 60),
    image_path: i.image_path || null, is_active: !!i.is_active,
  }))
  .handler(async ({ data, context }) => {
    if (!data.name || !data.name_mr) throw new Error("Enter both English and मराठी names");
    const db = context.supabase as any;
    const isType = data.kind === "store_type";
    const table = isType ? "store_categories" : "catalog_categories";
    const patch: Record<string, unknown> = { name: data.name, name_mr: data.name_mr, image_path: data.image_path, is_active: data.is_active };
    let id = data.id;
    if (id) {
      const b = await db.from(table).select("*").eq("id", id).maybeSingle();
      if (!b.data) throw new Error("Category not found");
      if (b.data.is_other) patch.is_active = true;
      fail(await db.from(table).update(patch).eq("id", id));
      await db.from("audit_logs").insert({ actor_id: context.userId, action: "category_update", target_table: table, target_id: id, before_state: b.data, after_state: patch });
    } else {
      const q = isType ? db.from(table).select("segment_id, sort_order") : db.from(table).select("sort_order").eq("service_type", data.kind === "food" ? "food" : "store");
      const ex = await (data.cityId ? q.eq("city_id", data.cityId) : q.is("city_id", null)).eq("is_other", false).order("sort_order", { ascending: false }).limit(1);
      const next = ((ex.data?.[0]?.sort_order as number) ?? 0) + 1;
      const row: Record<string, unknown> = { ...patch, city_id: data.cityId, sort_order: next };
      if (isType) {
        const seg = (await db.from(table).select("segment_id").limit(1)).data?.[0]?.segment_id;
        Object.assign(row, { segment_id: seg, rank: next, slug: (data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "type") + "-" + Date.now().toString(36) });
      } else row.service_type = data.kind === "food" ? "food" : "store";
      const r = await db.from(table).insert(row).select("id").single();
      fail(r); id = r.data.id;
      await db.from("audit_logs").insert({ actor_id: context.userId, action: "category_create", target_table: table, target_id: id, before_state: null, after_state: row });
    }
    return { ok: true as const, id };
  });

export const reorderCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: CatKind; ids: string[] }) => ({ kind: kindOk(i.kind), ids: (i.ids ?? []).map(String) }))
  .handler(async ({ data, context }) => {
    fail(await (context.supabase as any).rpc("staff_category_reorder", { _kind: data.kind, _ids: data.ids }));
    return { ok: true as const };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: CatKind; id: string; moveTo?: string | null }) => ({ kind: kindOk(i.kind), id: String(i.id), moveTo: i.moveTo || null }))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any).rpc("staff_category_delete", { _kind: data.kind, _id: data.id, _move_to: data.moveTo });
    fail(r);
    return r.data as { ok: boolean; moved: number };
  });

export const copyDefaultCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: CatKind; cityId: string }) => ({ kind: kindOk(i.kind), cityId: cityOk(i.cityId) }))
  .handler(async ({ data, context }) => {
    if (!data.cityId) throw new Error("Pick a city first");
    fail(await (context.supabase as any).rpc("staff_category_copy_default", { _kind: data.kind, _city_id: data.cityId }));
    return { ok: true as const };
  });

/** Store items without a shared category, grouped by their store section name. */
export const listUnmappedProductLabels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const m = await db.from("merchants").select("id").eq("service_type", "store").is("deleted_at", null);
    fail(m);
    const ids = (m.data ?? []).map((x: any) => x.id);
    if (!ids.length) return [];
    const p = await db.from("products").select("category_label").is("category_id", null).in("merchant_id", ids).limit(10000);
    fail(p);
    const c: Record<string, number> = {};
    for (const x of p.data ?? []) { const k = x.category_label ?? ""; c[k] = (c[k] ?? 0) + 1; }
    return Object.entries(c).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  });

export const applyProductCategoryMap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { map: { label: string; category_id: string }[] }) => ({ map: (i.map ?? []).filter((x) => x.category_id) }))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any).rpc("staff_apply_product_category_map", { _map: data.map });
    fail(r);
    return { updated: r.data as number };
  });

/* ---------- Merchant category suggestions ---------- */
export type CatSuggestion = {
  id: string; merchant_id: string; merchant: string | null; label: string; items: number; latest_at: string;
  legacy: boolean; city_id: string | null; guess_id: string | null; guess_name: string | null;
};
const svcOf = (k: CatKind) => (k === "food" ? "food" : "store");
const uuidOk = (v: unknown) => { if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v; throw new Error("Bad id"); };

export const listCategorySuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { kind: CatKind }) => ({ kind: kindOk(i?.kind) }))
  .handler(async ({ data, context }): Promise<CatSuggestion[]> => {
    const r = await (context.supabase as any).rpc("staff_list_category_suggestions", { _service: svcOf(data.kind) });
    fail(r);
    return (r.data ?? []) as CatSuggestion[];
  });

export const resolveCategorySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; mode: "create" | "map"; targetId?: string | null; nameEn?: string; nameMr?: string; imagePath?: string | null }) => ({
    id: uuidOk(i?.id), mode: i?.mode === "create" ? "create" : "map",
    targetId: i?.targetId ? uuidOk(i.targetId) : null,
    nameEn: String(i?.nameEn ?? "").slice(0, 60), nameMr: String(i?.nameMr ?? "").slice(0, 60), imagePath: i?.imagePath ?? null,
  }))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any).rpc("staff_resolve_category_suggestion", {
      _id: data.id, _mode: data.mode, _target_id: data.targetId, _name_en: data.nameEn || null, _name_mr: data.nameMr || null, _image_path: data.imagePath,
    });
    fail(r);
    return { moved: Number(r.data?.moved ?? 0) };
  });

export const rejectCategorySuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; reason: string }) => ({ id: uuidOk(i?.id), reason: String(i?.reason ?? "").trim().slice(0, 300) }))
  .handler(async ({ data, context }) => {
    if (!data.reason) throw new Error("Reason required");
    const r = await (context.supabase as any).rpc("staff_reject_category_suggestion", { _id: data.id, _reason: data.reason });
    fail(r);
    return { ok: true as const };
  });

export const applyLabelMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { rows: { id: string; target_id: string }[] }) => ({
    rows: (i?.rows ?? []).slice(0, 500).map((x) => ({ id: uuidOk(x.id), target_id: uuidOk(x.target_id) })),
  }))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any).rpc("staff_apply_label_mapping", { _rows: data.rows });
    fail(r);
    return { suggestions: Number(r.data?.suggestions ?? 0), moved: Number(r.data?.moved ?? 0) };
  });
