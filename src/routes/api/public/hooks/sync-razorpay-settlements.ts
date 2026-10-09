// Nightly (12:00 AM IST) Razorpay settlement sync, called by pg_cron.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/sync-razorpay-settlements")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];
        if (!key || !expected || key !== expected) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncRazorpaySettlements } = await import("@/lib/razorpay-settlements.server");
        const res = await syncRazorpaySettlements(supabaseAdmin, "nightly", 3);
        return Response.json({ ok: res.ok, count: res.count });
      },
    },
  },
});
