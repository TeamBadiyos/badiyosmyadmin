import { createServerFn } from "@tanstack/react-start";

/**
 * Play Store link for the Badiyos customer app.
 * Stored in `app_config.play_store_url` (id = 1) so it can be changed from the
 * database without a redeploy. This constant is the offline fallback.
 */
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.badiyos.customer&pcampaignid=web_share";

/**
 * Public read: anyone (logged-out visitors included) can fetch the Play Store
 * link shown by the marketing site's download buttons.
 */
export const getPlayStoreUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<string> => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(
        (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"])!,
        (process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          process.env["VITE_SUPABASE_PUBLISHABLE_KEY"])!,
        { auth: { persistSession: false } },
      );
      const { data, error } = await db
        .from("app_config")
        .select("play_store_url")
        .eq("id", 1)
        .maybeSingle();
      if (error) return PLAY_STORE_URL;
      const url = (data as { play_store_url?: string | null } | null)?.play_store_url;
      return url && url.length > 0 ? url : PLAY_STORE_URL;
    } catch {
      return PLAY_STORE_URL;
    }
  },
);
