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
