import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DISPLAY_TEMPLATES = [
  "CATEGORY_FIRST",
  "STORE_FIRST",
  "SEARCH_FIRST",
] as const;
export type DisplayTemplate = (typeof DISPLAY_TEMPLATES)[number];

export const VERTICAL_TYPES = ["SERVICE", "CATALOG"] as const;
export type VerticalType = (typeof VERTICAL_TYPES)[number];

export type Segment = {
  id: string;
  name: string;
  slug: string;
  vertical_type: string;
  display_template: string;
  icon_url: string | null;
  rank: number;
  is_active: boolean;
};

export type SegmentCategory = {
  id: string;
  segment_id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  rank: number;
  is_active: boolean;
  kind: "service" | "store";
};

async function requireSegmentStaff(
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
  if (!["super_admin", "ops_manager"].includes(data.role))
    throw new Error("Forbidden");
  return data.role as "super_admin" | "ops_manager";
}

export const listSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Segment[]> => {
    await requireSegmentStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("segments")
      .select("id,name,slug,vertical_type,display_template,icon_url,rank,is_active")
      .order("rank", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as Segment[];
  });

export const listSegmentCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SegmentCategory[]> => {
    await requireSegmentStaff(context.supabase, context.userId);
    const [svc, store] = await Promise.all([
      context.supabase
        .from("service_categories")
        .select("id,segment_id,name,slug,icon_url,rank,is_active")
        .order("rank", { ascending: true }),
      context.supabase
        .from("store_categories")
        .select("id,segment_id,name,slug,icon_url,rank,is_active")
        .order("rank", { ascending: true }),
    ]);
    if (svc.error) throw new Error(svc.error.message);
    if (store.error) throw new Error(store.error.message);
    return [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((svc.data ?? []) as any[]).map((r) => ({ ...r, kind: "service" as const })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((store.data ?? []) as any[]).map((r) => ({ ...r, kind: "store" as const })),
    ];
  });

export type UpsertSegmentInput = {
  id?: string | null;
  name: string;
  slug: string;
  vertical_type: string;
  display_template: string;
  icon_url?: string | null;
  rank?: number | null;
  is_active: boolean;
};

export const upsertSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertSegmentInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    if (!input?.slug?.trim()) throw new Error("Slug is required");
    if (!/^[a-z0-9-]+$/.test(input.slug))
      throw new Error("Slug must be lowercase letters, numbers or dashes");
    if (!(VERTICAL_TYPES as readonly string[]).includes(input.vertical_type))
      throw new Error("Invalid vertical type");
    if (!(DISPLAY_TEMPLATES as readonly string[]).includes(input.display_template))
      throw new Error("Invalid display template");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireSegmentStaff(context.supabase, context.userId);
    const row = {
      name: data.name.trim(),
      slug: data.slug.trim(),
      vertical_type: data.vertical_type,
      display_template: data.display_template,
      icon_url: data.icon_url?.trim() ? data.icon_url.trim() : null,
      is_active: data.is_active,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("segments")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    let rank = data.rank ?? null;
    if (rank === null) {
      const { data: last } = await context.supabase
        .from("segments")
        .select("rank")
        .order("rank", { ascending: false })
        .limit(1)
        .maybeSingle();
      rank = ((last?.rank as number | undefined) ?? -1) + 1;
    }
    const { data: created, error } = await context.supabase
      .from("segments")
      .insert({ ...row, rank })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const setSegmentActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireSegmentStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("segments")
      .update({ is_active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderSegments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orders: Array<{ id: string; rank: number }> }) => {
    if (!Array.isArray(input?.orders)) throw new Error("orders required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireSegmentStaff(context.supabase, context.userId);
    for (const o of data.orders) {
      const { error } = await context.supabase
        .from("segments")
        .update({ rank: o.rank })
        .eq("id", o.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
