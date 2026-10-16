import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PublicStorePage = {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  area: string | null;
  photo: string | null;
  rating: number | null;
  ratingCount: number;
  openNow: boolean;
  todayHours: string | null; // e.g. "9:00 am – 9:00 pm", "Closed today", null = not set
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fmt(t: string | null | undefined) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 || 12;
  return `${hh}:${String(m || 0).padStart(2, "0")} ${ap}`;
}

/** Public, read-only: only shop-front fields of an approved store. */
export const getPublicStorePage = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ slug: z.string().min(1).max(120) }).parse(raw))
  .handler(async ({ data }): Promise<PublicStorePage | null> => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const key = data.slug.trim();
    let q = db
      .from("merchants")
      .select("id, store_slug, store_name, store_category_id, address, city, shop_photo_url, rating_avg, rating_count, is_open, status, store_enabled, deleted_at")
      .eq("status", "approved")
      .is("deleted_at", null);
    q = UUID_RE.test(key) ? q.eq("id", key) : q.eq("store_slug", key.toLowerCase());
    const { data: m } = await q.maybeSingle();
    if (!m || !m.store_name) return null;

    const nowIst = new Date(Date.now() + 5.5 * 3600_000);
    const dow = nowIst.getUTCDay();
    const [{ data: cat }, { data: hrs }, { data: pub }] = await Promise.all([
      m.store_category_id
        ? db.from("store_categories").select("name").eq("id", m.store_category_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("merchant_store_hours").select("open_time, close_time, is_closed").eq("merchant_id", m.id).eq("day_of_week", dow).maybeSingle(),
      db.from("public_stores").select("is_open_now, short_address, photo_url").eq("id", m.id).maybeSingle(),
    ]);

    let todayHours: string | null = null;
    if (hrs) todayHours = hrs.is_closed ? "Closed today" : hrs.open_time && hrs.close_time ? `${fmt(hrs.open_time)} – ${fmt(hrs.close_time)}` : null;

    const photoPath = (pub?.photo_url as string | null) ?? m.shop_photo_url;
    const { catalogImageUrl } = await import("@/lib/catalog-images");
    const count = Number(m.rating_count ?? 0);
    return {
      id: m.id,
      slug: m.store_slug ?? m.id,
      name: m.store_name,
      type: (cat as { name?: string } | null)?.name ?? null,
      area: (pub?.short_address as string | null) ?? m.city ?? null,
      photo: catalogImageUrl(photoPath),
      rating: count >= 3 ? Math.round(Number(m.rating_avg ?? 0) * 10) / 10 : null,
      ratingCount: count,
      openNow: pub?.is_open_now ?? (!!m.is_open && m.store_enabled !== false),
      todayHours,
    };
  });
