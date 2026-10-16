import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DEMAND_SERVICES = ["maid", "clean_auto", "grocery", "food", "parcel"] as const;
export const DEMAND_LABEL: Record<string, string> = {
  maid: "Maid", clean_auto: "Clean Auto", grocery: "Grocery", food: "Food", parcel: "Parcel", website: "Website request",
};

export type DemandRow = {
  id: string;
  city: string;
  area: string | null;
  services: string[];
  phone: string | null;
  source: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  notified: boolean;
  createdAt: string;
};

export type DemandCity = {
  city: string;
  total: number;
  waiting: number;
  notified: number;
  latestAt: string;
  services: Record<string, number>;
  rows: DemandRow[];
};

export type WaitlistData = { total: number; totalNotified: number; cities: DemandCity[] };

export const notifyWaitlistArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ city: z.string().trim().min(1).max(80).nullable().optional(), segmentId: z.string().uuid().nullable().optional() }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<{ notified: number }> => {
    const { data: count, error } = await context.supabase.rpc("staff_notify_waitlist_area", {
      _city: data.city ?? null,
      _segment_id: data.segmentId ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (error) throw new Error(error.message);
    return { notified: Number(count ?? 0) };
  });

export const getWaitlistOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaitlistData> => {
    const db = context.supabase;
    const [w, l] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db.from("waitlist_requests") as any)
        .select("id, city, area, address_text, services, phone, source, latitude, longitude, status, notified_at, created_at")
        .order("created_at", { ascending: false })
        .limit(5000),
      db.from("city_interest_leads").select("id, city, phone, created_at").order("created_at", { ascending: false }).limit(2000),
    ]);
    if (w.error) throw new Error(w.error.message);
    const rows: DemandRow[] = ((w.data ?? []) as any[]).map((r) => ({
      id: r.id,
      city: (r.city ?? "").trim() || "Unknown city",
      area: r.area ?? (r.address_text ? String(r.address_text).replace(/\s*\[wants:[^\]]*\]/, "").trim() || null : null),
      services: (r.services ?? []) as string[],
      phone: r.phone ?? null,
      source: r.source ?? "outside-city",
      latitude: r.latitude == null ? null : Number(r.latitude),
      longitude: r.longitude == null ? null : Number(r.longitude),
      status: r.status,
      notified: !!r.notified_at,
      createdAt: r.created_at,
    }));
    for (const x of (l.data ?? []) as any[]) {
      rows.push({
        id: x.id, city: (x.city ?? "").trim() || "Unknown city", area: null, services: ["website"], phone: x.phone ?? null,
        source: "website", latitude: null, longitude: null, status: "pending", notified: false, createdAt: x.created_at,
      });
    }
    const map = new Map<string, DemandCity>();
    for (const r of rows) {
      const k = r.city.toLowerCase();
      const g = map.get(k) ?? { city: r.city, total: 0, waiting: 0, notified: 0, latestAt: r.createdAt, services: {}, rows: [] };
      map.set(k, g);
      g.total += 1;
      if (r.notified) g.notified += 1; else g.waiting += 1;
      if (r.createdAt > g.latestAt) g.latestAt = r.createdAt;
      for (const s of r.services) g.services[s] = (g.services[s] ?? 0) + 1;
      g.rows.push(r);
    }
    const cities = [...map.values()]
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
    return { total: rows.length, totalNotified: rows.filter((r) => r.notified).length, cities };
  });
