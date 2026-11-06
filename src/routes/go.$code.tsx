import { createFileRoute } from "@tanstack/react-router";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.badiyos.customer";

/** badiyos.com/go/<code> — logs a WhatsApp campaign link click, then redirects to the Play Store. */
export const Route = createFileRoute("/go/$code")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const code = String(params.code ?? "").toLowerCase();
        if (/^[a-z0-9-]{2,40}$/.test(code)) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabaseAdmin as any).from("wa_link_clicks").insert({
              link_code: code,
              user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
            });
          } catch (e) {
            console.error("[go] click log failed", e);
          }
        }
        return new Response(null, { status: 302, headers: { Location: PLAY_URL, "Cache-Control": "no-store" } });
      },
    },
  },
});
