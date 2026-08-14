import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ServicePriceRow = {
  id: string;
  duration_label: string;
  duration_minutes: number;
  subtitle: string | null;
  price: number;
  expert_payout: number | null;
  area_partner_payout: number | null;
  hq_revenue: number | null;
  icon: string | null;
  display_order: number;
  is_active: boolean;
  service_category_id: string | null;
};

async function requireSuperAdmin(
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

export const listServicePrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServicePriceRow[]> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("service_catalogue_config")
      .select("*")
      .order("display_order", { ascending: true })
      .order("duration_minutes", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      duration_label: r.duration_label,
      duration_minutes: r.duration_minutes,
      subtitle: r.subtitle ?? null,
      price: Number(r.price ?? 0),
      expert_payout: r.expert_payout != null ? Number(r.expert_payout) : null,
      area_partner_payout: r.area_partner_payout != null ? Number(r.area_partner_payout) : null,
      hq_revenue: r.hq_revenue != null ? Number(r.hq_revenue) : null,
      icon: r.icon ?? null,
      display_order: r.display_order ?? 0,
      is_active: r.is_active ?? true,
      service_category_id: r.service_category_id ?? null,
    }));
  });

export type UpdatePricePayload = {
  id: string;
  price: number;
  expert_payout: number | null;
  area_partner_payout: number | null;
  hq_revenue: number | null;
  is_active: boolean;
};

export const updateServicePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdatePricePayload) => {
    if (!input?.id) throw new Error("id required");
    if (!(input.price >= 0)) throw new Error("Price must be non-negative");
    for (const k of ["expert_payout", "area_partner_payout", "hq_revenue"] as const) {
      const v = input[k];
      if (v != null && !(v >= 0)) throw new Error(`${k} must be non-negative`);
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_service_price", {
      _id: data.id,
      _payload: {
        price: data.price,
        expert_payout: data.expert_payout,
        area_partner_payout: data.area_partner_payout,
        hq_revenue: data.hq_revenue,
        is_active: data.is_active,
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ServiceCategoryOption = {
  id: string;
  name: string;
  slug: string;
};

export const listServiceCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ServiceCategoryOption[]> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("service_categories")
      .select("id, name, slug")
      .order("rank", { ascending: true });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
  });

export type CreatePriceRowPayload = {
  service_category_id: string | null;
  duration_label: string;
  duration_minutes: number;
  subtitle: string | null;
  price: number;
  expert_payout: number | null;
  area_partner_payout: number | null;
  hq_revenue: number | null;
};

export const createServicePriceRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreatePriceRowPayload) => {
    if (!input?.duration_label?.trim()) throw new Error("Duration label is required");
    if (!(input.duration_minutes > 0)) throw new Error("Duration minutes must be positive");
    if (!(input.price >= 0)) throw new Error("Price must be non-negative");
    for (const k of ["expert_payout", "area_partner_payout", "hq_revenue"] as const) {
      const v = input[k];
      if (v != null && !(v >= 0)) throw new Error(`${k} must be non-negative`);
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc(
      "staff_create_service_catalogue_row",
      {
        _payload: {
          service_category_id: data.service_category_id,
          duration_label: data.duration_label.trim(),
          duration_minutes: data.duration_minutes,
          subtitle: data.subtitle,
          price: data.price,
          expert_payout: data.expert_payout,
          area_partner_payout: data.area_partner_payout,
          hq_revenue: data.hq_revenue,
          is_active: true,
        },
      },
    );
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const deleteServicePriceRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_delete_service_catalogue_row", {
      _id: data.id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
