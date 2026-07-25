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
  if (!data || data.status !== "active" || data.role !== "super_admin") {
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
