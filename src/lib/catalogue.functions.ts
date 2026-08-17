import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PRICING_TYPES = ["duration", "flat", "quantity"] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

export type CatalogueSegment = {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  rank: number;
  is_active: boolean;
  icon_url: string | null;
};

export type CatalogueCategory = {
  id: string;
  segment_id: string;
  name: string;
  slug: string;
  rank: number;
  is_active: boolean;
};

export type CatalogueService = {
  id: string;
  category_id: string;
  name: string;
  image_url: string | null;
  pricing_type: PricingType;
  display_order: number;
  is_active: boolean;
};

export type CataloguePriceOption = {
  id: string;
  service_id: string;
  label: string;
  duration_minutes: number | null;
  unit_label: string | null;
  customer_price: number;
  strikethrough_price: number | null;
  expert_payout: number | null;
  partner_commission: number | null;
  hq_share: number | null;
  display_order: number;
  is_active: boolean;
  image_url: string | null;
  gallery_urls: string[];
  video_url: string | null;
  description: string | null;
  inclusions: string[];
  exclusions: string[];
};

export type CatalogueTree = {
  segments: CatalogueSegment[];
  categories: CatalogueCategory[];
  services: CatalogueService[];
  priceOptions: CataloguePriceOption[];
};

async function requireCatalogueStaff(
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
  if (
    !data ||
    data.status !== "active" ||
    !["super_admin", "ops_manager"].includes(data.role)
  ) {
    throw new Error("Forbidden");
  }
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const listCatalogueTree = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CatalogueTree> => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const [segs, cats, svcs, opts] = await Promise.all([
      context.supabase
        .from("segments")
        .select("id,name,short_name,slug,rank,is_active,icon_url")
        .order("rank", { ascending: true }),
      context.supabase
        .from("service_categories")
        .select("id,segment_id,name,slug,rank,is_active")
        .order("rank", { ascending: true }),
      context.supabase
        .from("services")
        .select("id,category_id,name,image_url,pricing_type,display_order,is_active")
        .order("display_order", { ascending: true }),
      context.supabase
        .from("service_price_options")
        .select(
          "id,service_id,label,duration_minutes,unit_label,customer_price,strikethrough_price,expert_payout,partner_commission,hq_share,display_order,is_active,image_url,gallery_urls,video_url,description,inclusions,exclusions",
        )
        .order("display_order", { ascending: true }),
    ]);
    for (const r of [segs, cats, svcs, opts]) {
      if (r.error) throw new Error(r.error.message);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapOpt = (r: any): CataloguePriceOption => ({
      id: r.id,
      service_id: r.service_id,
      label: r.label,
      duration_minutes: r.duration_minutes ?? null,
      unit_label: r.unit_label ?? null,
      customer_price: Number(r.customer_price ?? 0),
      strikethrough_price: num(r.strikethrough_price),
      expert_payout: num(r.expert_payout),
      partner_commission: num(r.partner_commission),
      hq_share: num(r.hq_share),
      display_order: r.display_order ?? 0,
      is_active: r.is_active ?? true,
      image_url: r.image_url ?? null,
      gallery_urls: (r.gallery_urls ?? []) as string[],
      video_url: r.video_url ?? null,
      description: r.description ?? null,
      inclusions: (r.inclusions ?? []) as string[],
      exclusions: (r.exclusions ?? []) as string[],
    });
    return {
      segments: (segs.data ?? []) as CatalogueSegment[],
      categories: (cats.data ?? []) as CatalogueCategory[],
      services: (svcs.data ?? []) as CatalogueService[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      priceOptions: ((opts.data ?? []) as any[]).map(mapOpt),
    };
  });

// ---------------- Categories ----------------

export type UpsertCategoryInput = {
  id?: string | null;
  segment_id: string;
  name: string;
  rank?: number | null;
  is_active: boolean;
};

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertCategoryInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    if (!input?.segment_id) throw new Error("Segment is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const base = {
      segment_id: data.segment_id,
      name: data.name.trim(),
      is_active: data.is_active,
      rank: data.rank ?? 0,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("service_categories")
        .update(base)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    let slug = slugify(data.name);
    const { data: clash } = await context.supabase
      .from("service_categories")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const { data: created, error } = await context.supabase
      .from("service_categories")
      .insert({ ...base, slug })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const setCategoryActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("service_categories")
      .update({ is_active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Services ----------------

export type UpsertServiceInput = {
  id?: string | null;
  category_id: string;
  name: string;
  image_url: string | null;
  pricing_type: PricingType;
  display_order?: number | null;
  is_active: boolean;
};

export const upsertService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertServiceInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    if (!input?.category_id) throw new Error("Category is required");
    if (!(PRICING_TYPES as readonly string[]).includes(input.pricing_type))
      throw new Error("Invalid pricing type");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const row = {
      category_id: data.category_id,
      name: data.name.trim(),
      image_url: data.image_url?.trim() ? data.image_url.trim() : null,
      pricing_type: data.pricing_type,
      display_order: data.display_order ?? 0,
      is_active: data.is_active,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("services")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await context.supabase
      .from("services")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const deleteService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("services")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Price options ----------------

export type UpsertPriceOptionInput = {
  id?: string | null;
  service_id: string;
  label: string;
  duration_minutes: number | null;
  unit_label: string | null;
  customer_price: number;
  strikethrough_price: number | null;
  expert_payout: number | null;
  partner_commission: number | null;
  hq_share: number | null;
  display_order?: number | null;
  is_active: boolean;
  image_url?: string | null;
  gallery_urls?: string[];
  video_url?: string | null;
  description?: string | null;
  inclusions?: string[];
  exclusions?: string[];
};

export const upsertPriceOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertPriceOptionInput) => {
    if (!input?.service_id) throw new Error("Service is required");
    if (!input?.label?.trim()) throw new Error("Label is required");
    if (!(input.customer_price >= 0)) throw new Error("Customer price must be non-negative");
    for (const k of [
      "strikethrough_price",
      "expert_payout",
      "partner_commission",
      "hq_share",
    ] as const) {
      const v = input[k];
      if (v != null && !(v >= 0)) throw new Error(`${k} must be non-negative`);
    }
    if (input.duration_minutes != null && !(input.duration_minutes > 0))
      throw new Error("Duration minutes must be positive");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const row = {
      service_id: data.service_id,
      label: data.label.trim(),
      duration_minutes: data.duration_minutes,
      unit_label: data.unit_label?.trim() ? data.unit_label.trim() : null,
      customer_price: data.customer_price,
      strikethrough_price: data.strikethrough_price,
      expert_payout: data.expert_payout,
      partner_commission: data.partner_commission,
      hq_share: data.hq_share,
      display_order: data.display_order ?? 0,
      is_active: data.is_active,
      image_url: data.image_url?.trim() ? data.image_url.trim() : null,
      gallery_urls: (data.gallery_urls ?? []).filter((u) => !!u?.trim()),
      video_url: data.video_url?.trim() ? data.video_url.trim() : null,
      description: data.description?.trim() ? data.description.trim() : null,
      inclusions: (data.inclusions ?? []).map((t) => t.trim()).filter(Boolean),
      exclusions: (data.exclusions ?? []).map((t) => t.trim()).filter(Boolean),
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("service_price_options")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: created, error } = await context.supabase
      .from("service_price_options")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const deletePriceOption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("service_price_options")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- Task types ----------------

export type TaskType = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  inclusions: string[];
  exclusions: string[];
  rank: number;
  is_active: boolean;
};

export type ItemTaskTypeLink = {
  price_option_id: string;
  task_type_id: string;
  display_order: number;
};

export const listTaskTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskType[]> => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("task_types")
      .select("id,name,slug,description,image_url,inclusions,exclusions,rank,is_active")
      .order("rank", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description ?? null,
      image_url: r.image_url ?? null,
      inclusions: (r.inclusions ?? []) as string[],
      exclusions: (r.exclusions ?? []) as string[],
      rank: r.rank ?? 0,
      is_active: r.is_active ?? true,
    }));
  });

export const listItemTaskTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ItemTaskTypeLink[]> => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("item_task_types")
      .select("price_option_id,task_type_id,display_order")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      price_option_id: r.price_option_id,
      task_type_id: r.task_type_id,
      display_order: r.display_order ?? 0,
    }));
  });

export type UpsertTaskTypeInput = {
  id?: string | null;
  name: string;
  description?: string | null;
  image_url?: string | null;
  inclusions?: string[];
  exclusions?: string[];
  rank?: number | null;
  is_active: boolean;
};

export const upsertTaskType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertTaskTypeInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const base = {
      name: data.name.trim(),
      description: data.description?.trim() ? data.description.trim() : null,
      image_url: data.image_url?.trim() ? data.image_url.trim() : null,
      inclusions: (data.inclusions ?? []).map((t) => t.trim()).filter(Boolean),
      exclusions: (data.exclusions ?? []).map((t) => t.trim()).filter(Boolean),
      rank: data.rank ?? 0,
      is_active: data.is_active,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("task_types")
        .update(base)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    let slug = slugify(data.name);
    const { data: clash } = await context.supabase
      .from("task_types")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const { data: created, error } = await context.supabase
      .from("task_types")
      .insert({ ...base, slug })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created.id as string };
  });

export const deleteTaskType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("task_types")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setItemTaskTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { price_option_id: string; task_type_ids: string[] }) => {
    if (!input?.price_option_id) throw new Error("price_option_id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { error: delErr } = await context.supabase
      .from("item_task_types")
      .delete()
      .eq("price_option_id", data.price_option_id);
    if (delErr) throw new Error(delErr.message);
    const rows = (data.task_type_ids ?? []).map((id, i) => ({
      price_option_id: data.price_option_id,
      task_type_id: id,
      display_order: i,
    }));
    if (rows.length) {
      const { error } = await context.supabase.from("item_task_types").insert(rows);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------------- Availability overrides ----------------

export type AvailabilityTargetType = "category" | "item";

export type AvailabilityOverride = {
  id: string;
  target_type: AvailabilityTargetType;
  target_id: string;
  is_unavailable: boolean;
  unavailable_from: string | null;
  unavailable_until: string | null;
  reason: string | null;
  updated_at: string | null;
};

export function isEffectivelyUnavailable(
  o: AvailabilityOverride | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!o) return false;
  if (o.is_unavailable) return true;
  if (o.unavailable_from && o.unavailable_until) {
    const from = new Date(o.unavailable_from).getTime();
    const until = new Date(o.unavailable_until).getTime();
    const t = now.getTime();
    return t >= from && t < until;
  }
  return false;
}

export const listAvailabilityOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AvailabilityOverride[]> => {
    await requireCatalogueStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("availability_overrides")
      .select(
        "id,target_type,target_id,is_unavailable,unavailable_from,unavailable_until,reason,updated_at",
      );
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      target_type: r.target_type as AvailabilityTargetType,
      target_id: r.target_id,
      is_unavailable: !!r.is_unavailable,
      unavailable_from: r.unavailable_from ?? null,
      unavailable_until: r.unavailable_until ?? null,
      reason: r.reason ?? null,
      updated_at: r.updated_at ?? null,
    }));
  });

export type SetAvailabilityInput = {
  target_type: AvailabilityTargetType;
  target_ids: string[];
  is_unavailable: boolean;
  unavailable_from: string | null;
  unavailable_until: string | null;
  reason: string | null;
};

export const setAvailabilityOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SetAvailabilityInput) => {
    if (!input?.target_ids?.length) throw new Error("Select at least one target");
    if (input.target_type !== "category" && input.target_type !== "item")
      throw new Error("Invalid target type");
    if (input.unavailable_from && input.unavailable_until) {
      if (new Date(input.unavailable_until) <= new Date(input.unavailable_from))
        throw new Error("End time must be after start time");
    } else if (!!input.unavailable_from !== !!input.unavailable_until) {
      throw new Error("Provide both start and end of the schedule");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    for (const id of data.target_ids) {
      const { error } = await context.supabase.rpc("staff_set_availability_override", {
        _target_type: data.target_type,
        _target_id: id,
        _is_unavailable: data.is_unavailable,
        _unavailable_from: data.unavailable_from,
        _unavailable_until: data.unavailable_until,
        _reason: data.reason,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (error) throw new Error(error.message);
    }
    return { ok: true, count: data.target_ids.length };
  });

export const clearAvailabilityOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { target_type: AvailabilityTargetType; target_ids: string[] }) => {
    if (!input?.target_ids?.length) throw new Error("Select at least one target");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireCatalogueStaff(context.supabase, context.userId);
    for (const id of data.target_ids) {
      const { error } = await context.supabase.rpc("staff_clear_availability_override", {
        _target_type: data.target_type,
        _target_id: id,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
