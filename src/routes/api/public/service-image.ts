import { createFileRoute } from "@tanstack/react-router";

const SUPABASE_URL = "https://api.badiyos.com";
const anonKey = () =>
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

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
          { headers: { apikey: anonKey() } },
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
