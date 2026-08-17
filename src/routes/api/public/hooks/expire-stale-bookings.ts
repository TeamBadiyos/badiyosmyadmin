// Auto-expiry worker: bookings that no expert accepted within the configured
// window (dispatch_config.no_expert_timeout_minutes, default 30) are fully
// refunded via Razorpay and cancelled with reason 'no_expert_available'.
//
// Called by pg_cron. Auth: the Supabase anon key in the `apikey` header.
import { createFileRoute } from "@tanstack/react-router";

type Candidate = {
  id: string;
  price: number | string | null;
  razorpay_payment_id: string | null;
};

type RazorpayPayment = {
  id: string;
  status: string;
  amount: number;
  amount_refunded: number;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function basicAuth(): string {
  const id = process.env["RAZORPAY_KEY_ID"] || "";
  const secret = process.env["RAZORPAY_KEY_SECRET"] || "";
  return "Basic " + btoa(`${id}:${secret}`);
}

async function refundFully(
  paymentId: string,
  requestedRupees: number,
  bookingId: string,
): Promise<{ refundId: string | null; refundStatus: string; amount: number }> {
  if (!paymentId.startsWith("pay_")) {
    return { refundId: null, refundStatus: "failed", amount: 0 };
  }
  const lookup = await fetch(
    `https://api.razorpay.com/v1/payments/${paymentId}`,
    { headers: { Authorization: basicAuth() } },
  );
  const lookupBody = await lookup.text();
  if (!lookup.ok) {
    console.error("[expire-stale-bookings] payment lookup failed", {
      bookingId,
      status: lookup.status,
      body: lookupBody,
    });
    return { refundId: null, refundStatus: "failed", amount: 0 };
  }
  const pay = JSON.parse(lookupBody) as RazorpayPayment;
  if (pay.status !== "captured") {
    return { refundId: null, refundStatus: "failed", amount: 0 };
  }
  const availablePaise = Math.max(0, pay.amount - (pay.amount_refunded ?? 0));
  const refundPaise = Math.min(
    Math.round(requestedRupees * 100) || availablePaise,
    availablePaise,
  );
  if (refundPaise <= 0) {
    return { refundId: null, refundStatus: "failed", amount: 0 };
  }
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: refundPaise,
        speed: "normal",
        notes: { booking_id: bookingId, source: "auto_no_expert" },
      }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    console.error("[expire-stale-bookings] refund failed", {
      bookingId,
      status: res.status,
      body,
    });
    return { refundId: null, refundStatus: "failed", amount: 0 };
  }
  const data = JSON.parse(body) as { id: string; status: string };
  return {
    refundId: data.id,
    refundStatus: data.status,
    amount: refundPaise / 100,
  };
}

export const Route = createFileRoute("/api/public/hooks/expire-stale-bookings")(
  {
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

          const { data, error } = await supabaseAdmin.rpc(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "system_list_expired_unassigned_bookings" as any,
          );
          if (error) {
            console.error("[expire-stale-bookings] candidate query failed", error);
            return json(500, { error: error.message });
          }

          const candidates = (data ?? []) as Candidate[];
          const results: Array<Record<string, unknown>> = [];

          for (const b of candidates) {
            const price = Number(b.price ?? 0);
            let refundId: string | null = null;
            let refundStatus = "no_payment_recorded";
            let refundAmount = 0;

            if (b.razorpay_payment_id && price > 0) {
              const r = await refundFully(b.razorpay_payment_id, price, b.id);
              refundId = r.refundId;
              refundStatus = r.refundStatus;
              refundAmount = r.amount;
            }

            const { data: applied, error: applyErr } = await supabaseAdmin.rpc(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              "system_auto_cancel_booking_no_expert" as any,
              {
                _booking_id: b.id,
                _refund_amount: refundAmount,
                _refund_id: refundId,
                _refund_status: refundStatus,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
            );
            if (applyErr) {
              console.error("[expire-stale-bookings] cancel failed", {
                bookingId: b.id,
                error: applyErr.message,
              });
              results.push({ booking_id: b.id, error: applyErr.message });
              continue;
            }
            results.push({
              booking_id: b.id,
              refund_amount: refundAmount,
              refund_status: refundStatus,
              refund_id: refundId,
              applied,
            });
          }

          return json(200, { ok: true, processed: results.length, results });
        },
      },
    },
  },
);
