import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL = "https://dkneclwmmjlqswovtqno.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbmVjbHdtbWpscXN3b3Z0cW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4OTExMjMsImV4cCI6MjEwMDQ2NzEyM30.5wHGl9oFmY2AJysu9KlTpUwb-HQGtZZ6q-SHi1ced1Q";

/**
 * Public proxy for service-images. The bucket is private (public buckets are
 * blocked for this workspace), but RLS allows anon reads for images whose
 * item/service/category/segment chain is active. This route streams those
 * objects over a plain, cacheable public URL that customer apps can use in
 * <img src="...">.
 *
 * GET /api/public/service-image?path=items/<item-id>/<file>.jpg
 */
export const Route = createFileRoute("/api/public/service-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path")?.trim();
        if (!path || path.includes("..") || path.startsWith("/")) {
          return new Response("Invalid path", { status: 400 });
        }
        const upstream = await fetch(
          `${SUPABASE_URL}/storage/v1/object/service-images/${path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
        );
        if (!upstream.ok) {
          return new Response("Not found", { status: upstream.status === 400 ? 404 : upstream.status });
        }
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
            "cache-control": "public, max-age=3600",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
