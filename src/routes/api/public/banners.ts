import { createFileRoute } from "@tanstack/react-router";
import { catalogImageUrl } from "@/lib/catalog-images";

const SUPABASE_URL = "https://api.badiyos.com";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbmVjbHdtbWpscXN3b3Z0cW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTExMjMsImV4cCI6MjEwMDQ2NzEyM30.5wHGl9oFmY2AJysu9KlTpUwb-HQGtZZ6q-SHi1ced1Q";
const TABS = new Set(["all", "clean", "store", "food", "parcel", "rewards"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "content-type" };

/** GET /api/public/banners?tab=food&city_id=<zone uuid> — active, in-date banners for the Customer App. */
export const Route = createFileRoute("/api/public/banners")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams;
        const tab = (q.get("tab") ?? "all").toLowerCase();
        const city = q.get("city_id");
        if (!TABS.has(tab) || (city && !UUID.test(city))) {
          return Response.json({ error: "Invalid tab or city_id" }, { status: 400, headers: CORS });
        }
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/app_list_banners`, {
          method: "POST",
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ _tab: tab, _city_id: city || null }),
        });
        if (!r.ok) return Response.json({ error: "Unavailable" }, { status: 502, headers: CORS });
        const rows = (await r.json()) as Array<Record<string, unknown>>;
        const banners = rows.map((b) => ({ ...b, image_url: catalogImageUrl(b.image_path as string) }));
        return Response.json({ banners }, { headers: { ...CORS, "Cache-Control": "public, max-age=60" } });
      },
    },
  },
});
