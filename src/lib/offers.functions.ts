import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OffersAccess = {
  role: "super_admin" | "ops_manager" | "area_partner" | null;
  canWrite: boolean;
  city: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireOffersStaff(supabase: any, userId: string): Promise<OffersAccess> {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status, zone_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  const role = data.role as OffersAccess["role"];
  if (role === "area_partner") throw new Error("Forbidden");

  let city: string | null = null;
  if (data.zone_id) {
    const { data: zone } = await supabase
      .from("zones")
      .select("city")
      .eq("id", data.zone_id)
      .maybeSingle();
    city = (zone?.city as string | null) ?? null;
  }

  return {
    role,
    canWrite: role === "super_admin" || role === "ops_manager",
    city,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireOffersWriter(supabase: any, userId: string) {
  const access = await requireOffersStaff(supabase, userId);
  if (!access.canWrite) throw new Error("Forbidden");
  return access;
}

export const getOffersAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OffersAccess> =>
    requireOffersStaff(context.supabase, context.userId),
  );

/* ------------------------------------------------------------------ coupons */

export type CouponRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: "flat" | "percent" | "free_minutes";
  discount_value: number;
  max_discount: number | null;
  min_order_amount: number;
  valid_from: string;
  valid_until: string | null;
  total_usage_limit: number | null;
  per_user_limit: number;
  used_count: number;
  audience: string;
  is_active: boolean;
  created_at: string;
};

export const listCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CouponRow[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("coupons")
      .select(
        "id, code, title, description, discount_type, discount_value, max_discount, min_order_amount, valid_from, valid_until, total_usage_limit, per_user_limit, used_count, audience, is_active, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as CouponRow[];
  });

export type CouponInput = {
  id?: string | null;
  code: string;
  title: string;
  description?: string | null;
  discount_type: "flat" | "percent" | "free_minutes";
  discount_value: number;
  max_discount?: number | null;
  min_order_amount?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  total_usage_limit?: number | null;
  per_user_limit?: number | null;
  audience: "all" | "referral_reward";
};

export const saveCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CouponInput) => {
    if (!input?.code?.trim()) throw new Error("Code is required");
    if (!input.title?.trim()) throw new Error("Title is required");
    if (!(Number(input.discount_value) > 0)) throw new Error("Discount must be greater than 0");
    if (input.discount_type === "percent" && Number(input.discount_value) > 100)
      throw new Error("Percentage cannot exceed 100");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireOffersWriter(context.supabase, context.userId);
    const { data: id, error } = await context.supabase.rpc("staff_upsert_coupon", {
      _id: data.id ?? null,
      _code: data.code.trim(),
      _title: data.title.trim(),
      _description: data.description?.trim() || null,
      _discount_type: data.discount_type,
      _discount_value: Number(data.discount_value),
      _max_discount: data.max_discount == null ? null : Number(data.max_discount),
      _min_order_amount: Number(data.min_order_amount ?? 0),
      _valid_from: data.valid_from || null,
      _valid_until: data.valid_until || null,
      _total_usage_limit:
        data.total_usage_limit == null ? null : Number(data.total_usage_limit),
      _per_user_limit: Number(data.per_user_limit ?? 1),
      _audience: data.audience,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setCouponActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireOffersWriter(context.supabase, context.userId);
    const { error } = await context.supabase.rpc("staff_set_coupon_active", {
      _id: data.id,
      _active: data.active,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type RedemptionRow = {
  id: string;
  user_name: string | null;
  user_phone: string | null;
  booking_id: string | null;
  base_amount: number;
  discount_amount: number;
  status: string;
  created_at: string;
};

export const listCouponRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { couponId: string }) => {
    if (!input?.couponId) throw new Error("couponId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<RedemptionRow[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("coupon_redemptions")
      .select("id, user_id, booking_id, base_amount, discount_amount, status, created_at")
      .eq("coupon_id", data.couponId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean)));
    const nameById = new Map<string, { name: string | null; phone: string | null }>();
    if (ids.length) {
      const { data: users } = await context.supabase
        .from("users")
        .select("id, full_name, phone")
        .in("id", ids);
      for (const u of users ?? [])
        nameById.set(u.id, { name: u.full_name ?? null, phone: u.phone ?? null });
    }

    return (rows ?? []).map((r) => ({
      id: r.id,
      user_name: nameById.get(r.user_id)?.name ?? null,
      user_phone: nameById.get(r.user_id)?.phone ?? null,
      booking_id: r.booking_id,
      base_amount: Number(r.base_amount ?? 0),
      discount_amount: Number(r.discount_amount ?? 0),
      status: r.status,
      created_at: r.created_at,
    }));
  });

/* --------------------------------------------------------------- milestones */

export type MilestoneRow = {
  id: string;
  name: string;
  description: string | null;
  required_referrals: number;
  reward_discount_type: "flat" | "percent" | "free_minutes";
  reward_discount_value: number;
  reward_max_discount: number | null;
  reward_min_order_amount: number;
  reward_validity_days: number;
  is_active: boolean;
  earned_count: number;
};

export const listMilestones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MilestoneRow[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const [{ data: programs, error }, { data: awards }] = await Promise.all([
      context.supabase
        .from("referral_milestone_programs")
        .select(
          "id, name, description, required_referrals, reward_discount_type, reward_discount_value, reward_max_discount, reward_min_order_amount, reward_validity_days, is_active",
        )
        .order("required_referrals", { ascending: true }),
      context.supabase.from("referral_milestone_awards").select("program_id").limit(5000),
    ]);
    if (error) throw new Error(error.message);

    const counts = new Map<string, number>();
    for (const a of awards ?? [])
      if (a.program_id) counts.set(a.program_id, (counts.get(a.program_id) ?? 0) + 1);

    return (programs ?? []).map((p) => ({
      ...(p as Omit<MilestoneRow, "earned_count">),
      earned_count: counts.get(p.id) ?? 0,
    }));
  });

export type MilestoneAwardRow = {
  id: string;
  user_name: string | null;
  user_phone: string | null;
  referrals_at_award: number;
  coupon_code: string | null;
  created_at: string;
};

export const listMilestoneAwards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { programId: string }) => {
    if (!input?.programId) throw new Error("programId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<MilestoneAwardRow[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("referral_milestone_awards")
      .select("id, user_id, coupon_id, referrals_at_award, created_at")
      .eq("program_id", data.programId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean)));
    const couponIds = Array.from(
      new Set((rows ?? []).map((r) => r.coupon_id).filter((v): v is string => !!v)),
    );
    const [users, coupons] = await Promise.all([
      userIds.length
        ? context.supabase.from("users").select("id, full_name, phone").in("id", userIds)
        : Promise.resolve({ data: [] }),
      couponIds.length
        ? context.supabase.from("coupons").select("id, code").in("id", couponIds)
        : Promise.resolve({ data: [] }),
    ]);
    const uMap = new Map((users.data ?? []).map((u) => [u.id, u]));
    const cMap = new Map((coupons.data ?? []).map((c) => [c.id, c.code as string]));

    return (rows ?? []).map((r) => ({
      id: r.id,
      user_name: uMap.get(r.user_id)?.full_name ?? null,
      user_phone: uMap.get(r.user_id)?.phone ?? null,
      referrals_at_award: Number(r.referrals_at_award ?? 0),
      coupon_code: r.coupon_id ? cMap.get(r.coupon_id) ?? null : null,
      created_at: r.created_at,
    }));
  });

export type MilestoneInput = {
  id?: string | null;
  name: string;
  description?: string | null;
  required_referrals: number;
  reward_discount_type: "flat" | "percent" | "free_minutes";
  reward_discount_value: number;
  reward_max_discount?: number | null;
  reward_min_order_amount?: number | null;
  reward_validity_days?: number | null;
};

export const saveMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: MilestoneInput) => {
    if (!input?.name?.trim()) throw new Error("Name is required");
    if (!(Number(input.required_referrals) > 0))
      throw new Error("Required referrals must be at least 1");
    if (!(Number(input.reward_discount_value) > 0)) throw new Error("Reward must be greater than 0");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireOffersWriter(context.supabase, context.userId);
    const { data: id, error } = await context.supabase.rpc("staff_upsert_milestone_program", {
      _id: data.id ?? null,
      _name: data.name.trim(),
      _description: data.description?.trim() || null,
      _required_referrals: Number(data.required_referrals),
      _reward_discount_type: data.reward_discount_type,
      _reward_discount_value: Number(data.reward_discount_value),
      _reward_max_discount:
        data.reward_max_discount == null ? null : Number(data.reward_max_discount),
      _reward_min_order_amount: Number(data.reward_min_order_amount ?? 0),
      _reward_validity_days: Number(data.reward_validity_days ?? 30),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setMilestoneActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireOffersWriter(context.supabase, context.userId);
    const { error } = await context.supabase.rpc("staff_set_milestone_active", {
      _id: data.id,
      _active: data.active,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------------------------------------------------------- campaigns */

export type CampaignRow = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  deep_link: string | null;
  audience: string;
  status: string;
  show_in_offers: boolean;
  sent_at: string | null;
  recipients_count: number;
  created_at: string;
  delivered: number;
  failed: number;
  target_user_ids: string[] | null;
};

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CampaignRow[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("marketing_campaigns")
      .select(
        "id, title, body, image_url, deep_link, audience, status, show_in_offers, sent_at, recipients_count, created_at, target_user_ids",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const ids = (data ?? []).map((c) => c.id);
    const delivered = new Map<string, number>();
    const failed = new Map<string, number>();
    if (ids.length) {
      const { data: deliveries } = await context.supabase
        .from("campaign_deliveries")
        .select("campaign_id, status")
        .in("campaign_id", ids)
        .limit(10000);
      for (const d of deliveries ?? []) {
        const map = d.status === "failed" ? failed : delivered;
        map.set(d.campaign_id, (map.get(d.campaign_id) ?? 0) + 1);
      }
    }

    return (data ?? []).map((c) => ({
      ...(c as Omit<CampaignRow, "delivered" | "failed">),
      recipients_count: Number(c.recipients_count ?? 0),
      delivered: delivered.get(c.id) ?? 0,
      failed: failed.get(c.id) ?? 0,
    }));
  });

export type CampaignDeliveryRow = {
  id: string;
  user_name: string | null;
  user_phone: string | null;
  status: string;
  error: string | null;
  sent_at: string;
};

export const listCampaignDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { campaignId: string }) => {
    if (!input?.campaignId) throw new Error("campaignId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<CampaignDeliveryRow[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("campaign_deliveries")
      .select("id, user_id, status, error, sent_at")
      .eq("campaign_id", data.campaignId)
      .order("sent_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const uMap = new Map<string, { full_name: string | null; phone: string | null }>();
    if (ids.length) {
      const { data: users } = await context.supabase
        .from("users")
        .select("id, full_name, phone")
        .in("id", ids);
      for (const u of users ?? []) uMap.set(u.id, u);
    }

    return (rows ?? []).map((r) => ({
      id: r.id,
      user_name: uMap.get(r.user_id)?.full_name ?? null,
      user_phone: uMap.get(r.user_id)?.phone ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: (r as any).status ?? "sent",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (r as any).error ?? null,
      sent_at: r.sent_at,
    }));
  });

export const listCampaignCities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("zones")
      .select("city")
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return Array.from(
      new Set(((data ?? []) as { city: string | null }[]).map((z) => z.city).filter((c): c is string => !!c)),
    ).sort();
  });

export type CampaignInput = {
  id?: string | null;
  title: string;
  body: string;
  image_url?: string | null;
  deep_link?: string | null;
  audience: string;
  coupon_id?: string | null;
  show_in_offers?: boolean;
  target_user_ids?: string[] | null;
};

export const saveCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CampaignInput) => {
    if (!input?.title?.trim()) throw new Error("Title is required");
    if (!input.body?.trim()) throw new Error("Message is required");
    if (!input.audience?.trim()) throw new Error("Audience is required");
    if (input.audience === "specific_users" && !(input.target_user_ids ?? []).length)
      throw new Error("Select at least one customer");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireOffersWriter(context.supabase, context.userId);
    const { data: id, error } = await context.supabase.rpc("staff_upsert_campaign", {
      _id: data.id ?? null,
      _title: data.title.trim(),
      _body: data.body.trim(),
      _image_url: data.image_url?.trim() || null,
      _deep_link: data.deep_link?.trim() || null,
      _audience: data.audience,
      _coupon_id: data.coupon_id ?? null,
      _show_in_offers: data.show_in_offers ?? true,
      _target_user_ids:
        data.audience === "specific_users" ? (data.target_user_ids ?? []) : null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const sendCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ sent: number }> => {
    await requireOffersWriter(context.supabase, context.userId);
    const { data: sent, error } = await context.supabase.rpc("staff_send_campaign", {
      _id: data.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { sent: Number(sent ?? 0) };
  });

export type AudiencePreview = { total: number; reachable: number; unreachable: number };

/** How many customers an audience selects, and how many can actually receive a push. */
export const previewCampaignAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { audience: string; targetUserIds?: string[] | null }) => {
    if (!input?.audience) throw new Error("audience required");
    return input;
  })
  .handler(async ({ data, context }): Promise<AudiencePreview> => {
    await requireOffersStaff(context.supabase, context.userId);
    const { data: res, error } = await context.supabase.rpc("staff_campaign_audience_preview", {
      _audience: data.audience,
      _target_user_ids: data.targetUserIds ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    const r = (res ?? {}) as Partial<AudiencePreview>;
    return {
      total: Number(r.total ?? 0),
      reachable: Number(r.reachable ?? 0),
      unreachable: Number(r.unreachable ?? 0),
    };
  });

export type CampaignCustomer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  has_app: boolean;
};

/** Search customers to target a campaign at specific people. */
export const searchCampaignCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { search?: string | null; ids?: string[] | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<CampaignCustomer[]> => {
    await requireOffersStaff(context.supabase, context.userId);
    const db = context.supabase;
    const ids = data.ids ?? [];
    const search = (data.search ?? "").trim();

    let q = db
      .from("users")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .limit(ids.length ? ids.length : 20);

    if (ids.length) {
      q = q.in("id", ids);
    } else {
      if (!search) return [];
      const esc = search.replace(/[%,]/g, "");
      q = q.or(`full_name.ilike.%${esc}%,phone.ilike.%${esc}%,email.ilike.%${esc}%`);
    }

    const { data: users, error } = await q;
    if (error) throw new Error(error.message);
    const list = (users ?? []) as { id: string; full_name: string | null; phone: string | null }[];
    if (!list.length) return [];

    const userIds = list.map((u) => u.id);
    const [{ data: tokens }, { data: addrs }] = await Promise.all([
      db.from("device_tokens").select("user_id").eq("user_type", "customer").in("user_id", userIds),
      db.from("addresses").select("user_id, city").in("user_id", userIds),
    ]);
    const withApp = new Set(((tokens ?? []) as { user_id: string }[]).map((t) => t.user_id));
    const cityMap = new Map<string, string | null>();
    for (const a of (addrs ?? []) as { user_id: string; city: string | null }[]) {
      if (!cityMap.has(a.user_id)) cityMap.set(a.user_id, a.city);
    }

    return list.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      phone: u.phone,
      city: cityMap.get(u.id) ?? null,
      has_app: withApp.has(u.id),
    }));
  });
