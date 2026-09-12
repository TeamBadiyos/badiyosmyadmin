// Dispatch-alert worker.
//
// 1. Raises no-accept alerts for bookings waiting past the per-city threshold
//    (also runs every minute from a SQL-only pg_cron job; this route is a
//    backup and the entry point for WhatsApp delivery).
// 2. Drains pending WhatsApp ops alerts. AiSensy is not live yet, so sending
//    is a placeholder that logs — see src/lib/whatsapp.server.ts.
//
// Auth: the Supabase publishable key in the `apikey` header (same as the
// stale-bookings worker).
import { createFileRoute } from "@tanstack/react-router";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/hooks/dispatch-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ||
          request.headers.get("authorization")?.replace("Bearer ", "");
        const expected =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ||
          process.env["SUPABASE_ANON_KEY"];
        if (!apikey || !expected || apikey !== expected) {
          return json(401, { error: "Unauthorized" });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { sendOpsWhatsApp } = await import("@/lib/whatsapp.server");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raised, error: checkErr } = await (supabaseAdmin as any).rpc(
          "system_check_no_accept_alerts",
        );
        if (checkErr) {
          console.error("[dispatch-alerts] check failed", checkErr);
          return json(500, { error: checkErr.message });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: pending, error: pendErr } = await (supabaseAdmin as any).rpc(
          "system_pending_dispatch_whatsapp",
        );
        if (pendErr) {
          console.error("[dispatch-alerts] pending query failed", pendErr);
          return json(500, { error: pendErr.message });
        }

        const sent: string[] = [];
        for (const ev of (pending ?? []) as Array<{
          event_id: string;
          booking_id: string;
          alert_type: string;
          city: string | null;
          template_name: string | null;
          numbers: string[] | null;
          service_label: string | null;
        }>) {
          await sendOpsWhatsApp({
            numbers: ev.numbers ?? [],
            template: ev.template_name,
            params: {
              alert_type: ev.alert_type,
              city: ev.city ?? "",
              booking_id: ev.booking_id,
              service: ev.service_label ?? "Booking",
            },
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabaseAdmin as any).rpc("system_mark_dispatch_whatsapp", {
            _event_id: ev.event_id,
          });
          sent.push(ev.event_id);
        }

        return json(200, {
          ok: true,
          alerts_raised: (raised ?? []).length,
          whatsapp_processed: sent.length,
        });
      },
    },
  },
});
