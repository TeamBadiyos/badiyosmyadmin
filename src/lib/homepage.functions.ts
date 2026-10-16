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
    const { data, error } = await context.supabase
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

// ---- Clean Home app content ("clean_media") ----
export const getCleanMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { cityId: string | null }) => ({ cityId: i?.cityId ?? null }))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("staff_get_clean_media" as never, { _city: data.cityId } as never);
    if (error) throw new Error(error.message);
    return r as unknown as JsonRecord;
  });

export const saveCleanMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { cityId: string | null; payload: JsonRecord }) => ({ cityId: i?.cityId ?? null, payload: i.payload }))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("staff_save_clean_media" as never, { _city: data.cityId, _payload: data.payload } as never);
    if (error) throw new Error(error.message);
    return r as unknown as JsonRecord;
  });

export const resetCleanMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { cityId: string }) => {
    if (!i?.cityId) throw new Error("city required");
    return { cityId: i.cityId };
  })
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("staff_reset_clean_media" as never, { _city: data.cityId } as never);
    if (error) throw new Error(error.message);
    return r as unknown as JsonRecord;
  });

/** Uploads an already-compressed WebP (base64) to catalog-images/clean-media/… and returns its public URL. */
export const uploadCleanMediaImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { cityId: string | null; kind: "maid" | "tile"; base64: string }) => {
    if (i?.kind !== "maid" && i?.kind !== "tile") throw new Error("Invalid kind");
    const b64 = String(i?.base64 ?? "").replace(/^data:image\/webp;base64,/, "");
    if (!b64 || b64.length > 4_000_000) throw new Error("Image too large (max ~3 MB)");
    if (i.cityId && !/^[0-9a-f-]{36}$/i.test(i.cityId)) throw new Error("Invalid city");
    return { cityId: i.cityId ?? null, kind: i.kind, b64 };
  })
  .handler(async ({ data, context }) => {
    await requireHomepageStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { CATALOG_BUCKET, catalogImageUrl } = await import("@/lib/catalog-images");
    const bytes = Uint8Array.from(atob(data.b64), (c) => c.charCodeAt(0));
    const path = `clean-media/${data.cityId ?? "default"}/${data.kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;
    const { error } = await supabaseAdmin.storage.from(CATALOG_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: "upload_clean_media_image", target_table: "homepage_sections",
      target_id: data.cityId, before_state: null, after_state: { path, kind: data.kind },
    });
    return { url: catalogImageUrl(path) as string };
  });

// ---- Clean Home / Clean Auto app content ("<service>_content") ----
type SvcKey = "clean" | "wash";
const svc = (k: unknown): SvcKey => { if (k !== "clean" && k !== "wash") throw new Error("Invalid service"); return k; };

export const getServiceContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: SvcKey; cityId: string | null }) => ({ service: svc(i?.service), cityId: i?.cityId ?? null }))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("staff_get_service_content" as never, { _service_key: data.service, _city: data.cityId } as never);
    if (error) throw new Error(error.message);
    return r as unknown as JsonRecord;
  });

export const saveServiceContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: SvcKey; cityId: string | null; payload: JsonRecord }) => ({ service: svc(i?.service), cityId: i?.cityId ?? null, payload: i.payload }))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("staff_save_service_content" as never, { _service_key: data.service, _city: data.cityId, _payload: data.payload } as never);
    if (error) throw new Error(error.message);
    return r as unknown as JsonRecord;
  });

export const resetServiceContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: SvcKey; cityId: string }) => { if (!i?.cityId) throw new Error("city required"); return { service: svc(i?.service), cityId: i.cityId }; })
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("staff_reset_service_content" as never, { _service_key: data.service, _city: data.cityId } as never);
    if (error) throw new Error(error.message);
    return r as unknown as JsonRecord;
  });

export const uploadServiceContentImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { service: SvcKey; cityId: string | null; kind: "hero" | "card" | "option" | "banner"; base64: string }) => {
    if (!["hero", "card", "option", "banner"].includes(i?.kind)) throw new Error("Invalid kind");
    const b64 = String(i?.base64 ?? "").replace(/^data:image\/webp;base64,/, "");
    if (!b64 || b64.length > 4_000_000) throw new Error("Image too large (max ~3 MB)");
    if (i.cityId && !/^[0-9a-f-]{36}$/i.test(i.cityId)) throw new Error("Invalid city");
    return { service: svc(i?.service), cityId: i.cityId ?? null, kind: i.kind, b64 };
  })
  .handler(async ({ data, context }) => {
    await requireHomepageStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { CATALOG_BUCKET, catalogImageUrl } = await import("@/lib/catalog-images");
    const bytes = Uint8Array.from(atob(data.b64), (c) => c.charCodeAt(0));
    const path = `service-content/${data.service}/${data.cityId ?? "default"}/${data.kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;
    const { error } = await supabaseAdmin.storage.from(CATALOG_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: `upload_${data.service}_content_image`, target_table: "homepage_sections",
      target_id: data.cityId, before_state: null, after_state: { path, kind: data.kind },
    });
    return { url: catalogImageUrl(path) as string };
  });
