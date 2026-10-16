import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type LL = { lat: number; lng: number };

async function requireZoneStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const { data } = await supabase.from("staff_users").select("role,status").eq("auth_user_id", userId).maybeSingle();
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) throw new Error("Forbidden");
}

/** Draft city outline from OpenStreetMap (Nominatim polygon). Staff edit it before saving. */
export const fetchOsmCityBoundary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { city: string; state?: string }) => {
    const city = String(i?.city ?? "").trim();
    if (!city || city.length > 80) throw new Error("City required");
    return { city, state: String(i?.state ?? "").trim().slice(0, 80) };
  })
  .handler(async ({ data, context }) => {
    await requireZoneStaff(context.supabase, context.userId);
    const q = [data.city, data.state, "India"].filter(Boolean).join(", ");
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&polygon_threshold=0.0002&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": "BadiyosCommandCenter/1.0 (support@badiyos.com)", "Accept-Language": "en" } });
    if (!res.ok) throw new Error(`OpenStreetMap request failed [${res.status}]`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await res.json()) as any[];
    const hit = rows.find((r) => r?.geojson && /Polygon/.test(r.geojson.type));
    if (!hit) throw new Error("OpenStreetMap has no boundary shape for this city. Draw it by hand.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = hit.geojson as { type: string; coordinates: any };
    // Use the largest outer ring as one editable polygon.
    const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const ring = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
    const path: LL[] = ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
    return { label: String(hit.display_name ?? q), path };
  });

/** Snap a split line to roads between clicked points (Google Routes via the Maps connector). */
export const snapLineToRoads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { points: LL[] }) => {
    const pts = (i?.points ?? []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    if (pts.length < 2 || pts.length > 25 || pts.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) throw new Error("2–25 points needed");
    return { points: pts };
  })
  .handler(async ({ data, context }) => {
    await requireZoneStaff(context.supabase, context.userId);
    const lov = process.env.LOVABLE_API_KEY;
    const gm = process.env.GOOGLE_MAPS_API_KEY;
    if (!lov || !gm) return { snapped: false, path: data.points, note: "Road snapping needs the Google Maps connection; straight lines used." };
    const out: LL[] = [];
    for (let i = 0; i < data.points.length - 1; i++) {
      const a = data.points[i], b = data.points[i + 1];
      const r = await fetch("https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": gm, "Content-Type": "application/json",
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
          destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
          travelMode: "TWO_WHEELER",
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error(`Routes failed [${r.status}]: ${t}`);
        return { snapped: false, path: data.points, note: `Road snapping failed [${r.status}]; straight lines used.` };
      }
      const j = await r.json();
      const enc = j?.routes?.[0]?.polyline?.encodedPolyline as string | undefined;
      const seg = enc ? decodePolyline(enc) : [a, b];
      seg[0] = a; seg[seg.length - 1] = b;
      out.push(...(i === 0 ? seg : seg.slice(1)));
    }
    return { snapped: true, path: out, note: null as string | null };
  });

function decodePolyline(s: string): LL[] {
  const pts: LL[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < s.length) {
    for (const k of [0, 1]) {
      let shift = 0, res = 0, b: number;
      do { b = s.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}
