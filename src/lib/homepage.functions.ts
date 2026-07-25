import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonRecord = Record<string, any>;

export type HomepageSection = {
  section_id: string;
  section_type: string;
  display_order: number;
  is_active: boolean;
  payload: JsonRecord;
  city_id: string | null;
  updated_at: string | null;
};

async function requireHomepageStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  if (!["super_admin", "ops_manager"].includes(data.role)) throw new Error("Forbidden");
  return data.role as "super_admin" | "ops_manager";
}

export const listHomepageSections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HomepageSection[]> => {
    await requireHomepageStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("homepage_sections")
      .select("*")
      .order("section_type", { ascending: true })
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      section_id: r.section_id,
      section_type: r.section_type,
      display_order: r.display_order ?? 0,
      is_active: r.is_active ?? true,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      city_id: r.city_id ?? null,
      updated_at: r.updated_at ?? null,
    }));
  });

export type UpsertHomepageSectionInput = {
  id?: string | null;
  section_type: string;
  display_order?: number | null;
  is_active: boolean;
  payload: JsonRecord;
  city_id?: string | null;
};

export const upsertHomepageSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertHomepageSectionInput) => {
    if (!input?.section_type?.trim()) throw new Error("section_type required");
    if (!input?.payload || typeof input.payload !== "object")
      throw new Error("payload required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc(
      "staff_upsert_homepage_section",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { _payload: data as any },
    );
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setHomepageSectionActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc(
      "staff_set_homepage_section_active",
      { _id: data.id, _active: data.active },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderHomepageSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orders: Array<{ id: string; display_order: number }> }) => {
    if (!Array.isArray(input?.orders)) throw new Error("orders required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc(
      "staff_reorder_homepage_sections",
      { _orders: data.orders },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
