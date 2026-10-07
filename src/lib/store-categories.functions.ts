import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StoreCategory = {
  id: string;
  segment_id: string;
  name: string;
  slug: string;
  icon: string | null;
  icon_url: string | null;
  sort_order: number;
  is_active: boolean;
  updated_at: string | null;
  merchants_count: number;
};

type StaffRole = "super_admin" | "ops_manager" | string;

async function resolveStaffRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<StaffRole> {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  if (!["super_admin", "ops_manager"].includes(data.role))
    throw new Error("Forbidden");
  return data.role as StaffRole;
}

async function requireSuperAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const role = await resolveStaffRole(supabase, userId);
  if (role !== "super_admin")
    throw new Error("Only a super admin can change store categories");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const listStoreCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ role: StaffRole; categories: StoreCategory[] }> => {
      const role = await resolveStaffRole(context.supabase, context.userId);

      const { data, error } = await context.supabase
        .from("store_categories")
        .select(
          "id,segment_id,name,slug,icon,icon_url,sort_order,rank,is_active,updated_at",
        )
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as Array<Record<string, unknown>>;

      const { data: merchantRows, error: mErr } = await context.supabase
        .from("merchants")
        .select("store_category_id")
        .not("store_category_id", "is", null);
      if (mErr) throw new Error(mErr.message);

      const counts = new Map<string, number>();
      for (const m of (merchantRows ?? []) as Array<{
        store_category_id: string | null;
      }>) {
        if (!m.store_category_id) continue;
        counts.set(
          m.store_category_id,
          (counts.get(m.store_category_id) ?? 0) + 1,
        );
      }

      const categories: StoreCategory[] = rows.map((r) => ({
        id: r["id"] as string,
        segment_id: r["segment_id"] as string,
        name: r["name"] as string,
        slug: r["slug"] as string,
        icon: (r["icon"] as string | null) ?? null,
        icon_url: (r["icon_url"] as string | null) ?? null,
        sort_order: (r["sort_order"] as number) ?? (r["rank"] as number) ?? 0,
        is_active: Boolean(r["is_active"]),
        updated_at: (r["updated_at"] as string | null) ?? null,
        merchants_count: counts.get(r["id"] as string) ?? 0,
      }));

      return { role, categories };
    },
  );

export const listStoreSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await resolveStaffRole(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("segments")
      .select("id,name,slug,vertical_type,is_active")
      .eq("vertical_type", "CATALOG")
      .order("rank", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      vertical_type: string;
      is_active: boolean;
    }>;
  });

export type UpsertStoreCategoryInput = {
  id?: string | null;
  segment_id: string;
  name: string;
  icon: string | null;
  sort_order: number;
};

export const upsertStoreCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertStoreCategoryInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    if (!input?.segment_id) throw new Error("Segment is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const name = data.name.trim();
    const sortOrder = Number.isFinite(data.sort_order) ? data.sort_order : 0;
    const icon = data.icon?.trim() ? data.icon.trim() : null;

    if (data.id) {
      const { data: before, error: beforeErr } = await context.supabase
        .from("store_categories")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (beforeErr) throw new Error(beforeErr.message);
      if (!before) throw new Error("Store category not found");

      const { data: after, error } = await context.supabase
        .from("store_categories")
        .update({
          name,
          icon,
          sort_order: sortOrder,
          segment_id: data.segment_id,
        })
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "update_store_category",
        target_table: "store_categories",
        target_id: data.id,
        before_state: before,
        after_state: after,
      });

      return { id: data.id as string };
    }

    let slug = slugify(name);
    if (!slug) throw new Error("Name must contain letters or numbers");
    const { data: clash } = await context.supabase
      .from("store_categories")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const { data: created, error } = await context.supabase
      .from("store_categories")
      .insert({
        segment_id: data.segment_id,
        name,
        slug,
        icon,
        sort_order: sortOrder,
        rank: sortOrder,
        is_active: true,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "create_store_category",
      target_table: "store_categories",
      target_id: created.id,
      before_state: null,
      after_state: created,
    });

    return { id: created.id as string };
  });

export const setStoreCategoryActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => {
    if (!input?.id) throw new Error("Category is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { data: before, error: beforeErr } = await context.supabase
      .from("store_categories")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("Store category not found");

    const { data: after, error } = await context.supabase
      .from("store_categories")
      .update({ is_active: data.is_active })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: data.is_active
        ? "activate_store_category"
        : "deactivate_store_category",
      target_table: "store_categories",
      target_id: data.id,
      before_state: before,
      after_state: after,
    });

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Category photo + category detail (stores & items)
// ---------------------------------------------------------------------------

export const setStoreCategoryPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; photo: { base64: string; contentType: string } | null }) => {
      if (!input?.id) throw new Error("Category is required");
      if (input.photo) {
        if (input.photo.base64.length > 7_000_000) throw new Error("Photo too large (max ~5 MB)");
        if (!input.photo.contentType.startsWith("image/")) throw new Error("Only image files allowed");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data: before, error: bErr } = await admin
      .from("store_categories").select("*").eq("id", data.id).maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new Error("Store category not found");

    let path: string | null = null;
    if (data.photo) {
      const ext = (data.photo.contentType.split("/")[1] ?? "jpg").replace("jpeg", "jpg").slice(0, 5);
      path = `categories/${data.id}-${Date.now()}.${ext}`;
      const { error } = await admin.storage
        .from("product-images")
        .upload(path, Buffer.from(data.photo.base64, "base64"), {
          contentType: data.photo.contentType,
          upsert: false,
        });
      if (error) throw new Error(`Photo upload failed: ${error.message}`);
    }
    const { data: after, error } = await admin
      .from("store_categories").update({ icon_url: path }).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    await admin.from("audit_logs").insert({
      actor_id: context.userId,
      action: path ? "update_store_category_photo" : "remove_store_category_photo",
      target_table: "store_categories",
      target_id: data.id,
      before_state: before,
      after_state: after,
    });
    return { ok: true };
  });

export async function signCategoryPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rel = paths.filter((p) => p && !/^https?:\/\//.test(p));
  for (const p of paths) if (p && /^https?:\/\//.test(p)) out.set(p, p);
  if (!rel.length) return out;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from("product-images").createSignedUrls(rel, 3600);
  for (const r of data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  return out;
}

export const signStoreCategoryPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paths: string[] }) => input)
  .handler(async ({ data, context }) => {
    await resolveStaffRole(context.supabase, context.userId);
    const m = await signCategoryPaths(data.paths.slice(0, 200));
    return Object.fromEntries(m) as Record<string, string>;
  });

export type CategoryStore = {
  id: string;
  storeName: string;
  ownerName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  status: string;
  acceptingOrders: boolean;
  photoUrl: string | null;
  productsCount: number;
  activeProducts: number;
};

export type CategoryItem = {
  id: string;
  merchantId: string;
  storeName: string;
  name: string;
  categoryLabel: string | null;
  price: number;
  unit: string | null;
  stock: number;
  lowStock: number;
  isActive: boolean;
  adminHidden: boolean;
  approvalStatus: string;
  imageUrl: string | null;
};

export const getStoreCategoryDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Category is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ stores: CategoryStore[]; items: CategoryItem[] }> => {
    await resolveStaffRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data: merchants, error } = await admin
      .from("merchants")
      .select("id, store_name, owner_name, phone, city, address, status, is_accepting_orders, shop_photo_url, deleted_at")
      .eq("store_category_id", data.id)
      .is("deleted_at", null)
      .order("store_name", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = (merchants ?? []) as any[];
    const ids = ms.map((m) => m.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prods: any[] = [];
    if (ids.length) {
      const { data: p, error: pErr } = await admin
        .from("products")
        .select("id, merchant_id, name, category_label, price, unit, stock_quantity, low_stock_threshold, is_active, admin_hidden, approval_status, image_url")
        .in("merchant_id", ids)
        .order("name", { ascending: true })
        .limit(2000);
      if (pErr) throw new Error(pErr.message);
      prods = p ?? [];
    }
    const signed = await signCategoryPaths(
      [...prods.map((p) => p.image_url), ...ms.map((m) => m.shop_photo_url)].filter(Boolean),
    );
    const nameById = new Map(ms.map((m) => [m.id, m.store_name ?? "Store"]));
    const stores: CategoryStore[] = ms.map((m) => {
      const mine = prods.filter((p) => p.merchant_id === m.id);
      return {
        id: m.id,
        storeName: m.store_name ?? "Unnamed store",
        ownerName: m.owner_name,
        phone: m.phone,
        city: m.city,
        address: m.address,
        status: m.status ?? "draft",
        acceptingOrders: !!m.is_accepting_orders,
        photoUrl: m.shop_photo_url ? signed.get(m.shop_photo_url) ?? null : null,
        productsCount: mine.length,
        activeProducts: mine.filter((p) => p.is_active && !p.admin_hidden).length,
      };
    });
    const items: CategoryItem[] = prods.map((p) => ({
      id: p.id,
      merchantId: p.merchant_id,
      storeName: nameById.get(p.merchant_id) ?? "Store",
      name: p.name,
      categoryLabel: p.category_label,
      price: Number(p.price ?? 0),
      unit: p.unit,
      stock: Number(p.stock_quantity ?? 0),
      lowStock: Number(p.low_stock_threshold ?? 0),
      isActive: !!p.is_active,
      adminHidden: !!p.admin_hidden,
      approvalStatus: p.approval_status ?? "approved",
      imageUrl: p.image_url ? signed.get(p.image_url) ?? null : null,
    }));
    return { stores, items };
  });
