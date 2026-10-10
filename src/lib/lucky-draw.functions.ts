import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireSuperAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active" || data.role !== "super_admin") {
    throw new Error("Super Admin only");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(supabase: any, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export type LuckyCampaign = {
  id: string;
  title: string;
  description: string | null;
  banner_url: string | null;
  start_at: string;
  end_at: string;
  enrolment_target: number;
  is_active: boolean;
  show_enrolled_count: boolean;
  show_leaderboard: boolean;
  referral_bonus_enabled: boolean;
  leaderboard_rewards_enabled: boolean;
  leaderboard_top_ranks: number;
  winners_published: boolean;
  draw_executed_at: string | null;
  draw_seed: string | null;
};

export type LuckyPrize = {
  id: string;
  campaign_id: string;
  prize_type: "lucky_draw" | "leaderboard";
  name: string;
  photo_url: string | null;
  value_inr: number;
  quantity: number;
  sort_no: number;
  rank_from: number | null;
  rank_to: number | null;
};

export const listLuckyCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("lucky_draw_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as LuckyCampaign[];
  });

export const getLuckyCampaignDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { data: prizes, error } = await context.supabase
      .from("lucky_draw_prizes")
      .select("*")
      .eq("campaign_id", data.id)
      .order("sort_no");
    if (error) throw new Error(error.message);
    const overview = await rpc(context.supabase, "staff_lucky_draw_overview", { _campaign_id: data.id });
    return {
      prizes: (prizes ?? []) as LuckyPrize[],
      overview: overview as {
        enrolled: number;
        total_entries: number;
        enrolments: Array<{
          user_id: string;
          entry_no: string;
          full_name: string | null;
          phone: string | null;
          referrals: number;
          entries: number;
          tickets?: string[];
          rank: number;
          enrolled_at: string;
        }>;
        winners: Array<{
          id: string;
          prize_type: string;
          rank: number | null;
          entries: number | null;
          referrals: number | null;
          prize_name: string | null;
          prize_value: number | null;
          full_name: string | null;
          phone: string | null;
          entry_no: string | null;
        }>;
      },
    };
  });

export const saveLuckyCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string | null; payload: Record<string, unknown> }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    return (await rpc(context.supabase, "staff_lucky_draw_save_campaign", {
      _id: data.id,
      _payload: data.payload,
    })) as string;
  });

export const deleteLuckyCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    await rpc(context.supabase, "staff_lucky_draw_delete_campaign", { _id: data.id });
    return { ok: true };
  });

export const saveLuckyPrize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string | null; campaignId: string; payload: Record<string, unknown> }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    return (await rpc(context.supabase, "staff_lucky_draw_save_prize", {
      _id: data.id,
      _campaign_id: data.campaignId,
      _payload: data.payload,
    })) as string;
  });

export const deleteLuckyPrize = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    await rpc(context.supabase, "staff_lucky_draw_delete_prize", { _id: data.id });
    return { ok: true };
  });

export const runLuckyDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    return (await rpc(context.supabase, "staff_lucky_draw_run", { _campaign_id: data.id })) as {
      seed: string;
      lucky_winners: number;
      leaderboard_winners: number;
    };
  });

export const resetLuckyDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason: string }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    await rpc(context.supabase, "staff_lucky_draw_reset", { _campaign_id: data.id, _reason: data.reason });
    return { ok: true };
  });

export const publishLuckyWinners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; published: boolean }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    await rpc(context.supabase, "staff_lucky_draw_publish", {
      _campaign_id: data.id,
      _published: data.published,
    });
    return { ok: true };
  });

const LUCKY_MEDIA_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Super Admin only: uploads a banner/prize photo to the public lucky-draw-media bucket and returns its public URL. */
export const uploadLuckyMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "banner" | "prize"; contentType: string; base64: string }) => d)
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const ext = LUCKY_MEDIA_TYPES[data.contentType];
    if (!ext) throw new Error("Only JPG, PNG or WebP allowed");
    const buf = Buffer.from(data.base64, "base64");
    if (buf.byteLength > 2 * 1024 * 1024) throw new Error("Max 2 MB allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${data.kind}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bucket = supabaseAdmin.storage.from("lucky-draw-media");
    const { error } = await bucket.upload(path, buf, { contentType: data.contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return { url: bucket.getPublicUrl(path).data.publicUrl };
  });
