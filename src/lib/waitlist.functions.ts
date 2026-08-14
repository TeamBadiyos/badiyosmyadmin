import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WaitlistGroup = {
  key: string;
  city: string;
  area: string;
  count: number;
  latestAt: string;
  segments: { id: string; name: string; count: number }[];
};

export type WaitlistData = {
  total: number;
  groups: WaitlistGroup[];
  segments: { id: string; name: string }[];
};

export const getWaitlistOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { segmentId?: string | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<WaitlistData> => {
    const db = context.supabase;

    const { data: segRows, error: segErr } = await db
      .from("segments")
      .select("id, name")
      .order("rank", { ascending: true });
    if (segErr) throw new Error(segErr.message);
    const segments = ((segRows ?? []) as { id: string; name: string }[]).map((s) => ({
      id: s.id,
      name: s.name,
    }));
    const segMap = new Map(segments.map((s) => [s.id, s.name]));

    let q = db
      .from("waitlist_requests")
      .select("id, segment_id, city, address_text, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (data.segmentId) q = q.eq("segment_id", data.segmentId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const raw = (rows ?? []) as {
      id: string;
      segment_id: string | null;
      city: string | null;
      address_text: string | null;
      created_at: string;
    }[];

    const map = new Map<string, WaitlistGroup & { segCounts: Map<string, number> }>();
    for (const r of raw) {
      const city = (r.city ?? "").trim() || "Unknown city";
      const area = (r.address_text ?? "").trim() || "Unspecified area";
      const key = `${city}||${area}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          city,
          area,
          count: 0,
          latestAt: r.created_at,
          segments: [],
          segCounts: new Map(),
        };
        map.set(key, g);
      }
      g.count += 1;
      if (r.created_at > g.latestAt) g.latestAt = r.created_at;
      const sid = r.segment_id ?? "none";
      g.segCounts.set(sid, (g.segCounts.get(sid) ?? 0) + 1);
    }

    const groups = Array.from(map.values())
      .map(({ segCounts, ...g }) => ({
        ...g,
        segments: Array.from(segCounts.entries())
          .map(([id, count]) => ({
            id,
            name: segMap.get(id) ?? "No segment",
            count,
          }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));

    return { total: raw.length, groups, segments };
  });
