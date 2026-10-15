import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const BANNER_TABS = ["all", "clean", "store", "food", "parcel", "rewards"] as const;
export const BANNER_LINKS = ["none", "service", "store", "coupon", "lucky_draw"] as const;

export type Banner = {
  id: string;
  title: string;
  image_path: string;
  app_tab: (typeof BANNER_TABS)[number];
  link_type: (typeof BANNER_LINKS)[number];
  link_target: string | null;
  city_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  display_order: number;
};

export type BannerInput = Omit<Banner, "id" | "display_order"> & { id?: string | null };

export const listBanners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const [b, z] = await Promise.all([
      sb.from("app_banners").select("*").order("display_order"),
      sb.from("zones").select("id, name, city").is("deleted_at", null).order("city"),
    ]);
    if (b.error) throw new Error(b.error.message);
    return {
      banners: (b.data ?? []) as Banner[],
      cities: ((z.data ?? []) as { id: string; name: string; city: string }[]),
    };
  });

export const saveBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: BannerInput) => {
    if (!i?.title?.trim()) throw new Error("Title required");
    if (!i?.image_path) throw new Error("Image required");
    if (!BANNER_TABS.includes(i.app_tab)) throw new Error("Invalid tab");
    if (!BANNER_LINKS.includes(i.link_type)) throw new Error("Invalid link");
    return i;
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: id, error } = await (context.supabase as any).rpc("staff_save_banner", { _p: data });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const setBannerActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; active: boolean }) => i)
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_set_banner_active", { _id: data.id, _active: data.active });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const moveBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; dir: -1 | 1 }) => i)
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_move_banner", { _id: data.id, _dir: data.dir });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_delete_banner", { _id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
