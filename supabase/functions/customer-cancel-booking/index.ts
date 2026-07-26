// Customer-initiated cancellation with tiered refunds.
//
// Auth: verify_jwt is enabled in config.toml — the caller MUST be the
// authenticated customer who owns the booking. Ownership is enforced both
// here (loading via the caller's JWT) and inside
// customer_cancel_booking_apply which checks auth.uid() = user_id.
//
// Refund tiers:
//   confirmed / accepted (no expert assigned yet) -> full refund, fee 0
//   expert_assigned (assigned, not started)       -> full refund - ₹100 fee
//   in_progress / completed / cancelled / rejected -> REJECT the cancel
//
// The refund is initiated via Razorpay's Refunds API against the payment
// stored on the booking (razorpay_payment_id). If Razorpay reports failure
// the DB is NOT mutated so we don't mark a booking cancelled without a
// refund pending.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ||
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
  "";
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") || "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") || "";

const CANCEL_FEE_ASSIGNED = 100; // ₹100 flat fee once an expert has been assigned

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

type Booking = {
  id: string;
  user_id: string;
  status: string;
  price: number | string | null;
  razorpay_payment_id: string | null;
  assigned_expert_id: string | null;
};

async function razorpayRefund(
  paymentId: string,
  amountRupees: number,
  bookingId: string,
): Promise<{ id: string; status: string }> {
  const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(amountRupees * 100), // paise
        speed: "normal",
        notes: { booking_id: bookingId, source: "customer_cancel" },
      }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Razorpay refund failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { id: string; status: string };
  return { id: data.id, status: data.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json(401, { error: "Unauthorized" });
  }

  let payload: { booking_id?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const bookingId = payload.booking_id;
  if (!bookingId) return json(400, { error: "booking_id required" });

  // Client scoped to the caller's JWT — RLS applies as the customer.
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { error: "Unauthorized" });
  }
  const userId = userData.user.id;

  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .select(
      "id, user_id, status, price, razorpay_payment_id, assigned_expert_id",
    )
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (bErr) return json(500, { error: bErr.message });
  if (!booking) return json(404, { error: "Booking not found" });
  if (booking.user_id !== userId) return json(403, { error: "Forbidden" });

  const status = booking.status;
  if (!["confirmed", "accepted", "expert_assigned"].includes(status)) {
    return json(409, {
      error: "Cannot cancel — service has already started",
      current_status: status,
    });
  }

  const originalAmount = Number(booking.price ?? 0);
  const fee = status === "expert_assigned" ? CANCEL_FEE_ASSIGNED : 0;
  const refundAmount = Math.max(0, originalAmount - fee);

  let refundId: string | null = null;
  let refundStatus: string | null = null;
  if (refundAmount > 0 && booking.razorpay_payment_id) {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json(500, {
        error:
          "Razorpay credentials not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)",
      });
    }
    try {
      const r = await razorpayRefund(
        booking.razorpay_payment_id,
        refundAmount,
        booking.id,
      );
      refundId = r.id;
      refundStatus = r.status;
    } catch (e) {
      console.error("[customer-cancel-booking] refund error", e);
      return json(502, { error: String(e) });
    }
  } else if (refundAmount > 0 && !booking.razorpay_payment_id) {
    // No payment recorded — cancel with refund_amount = 0 and note absence.
    refundStatus = "no_payment_recorded";
  }

  const { data: applyRes, error: applyErr } = await supabase.rpc(
    "customer_cancel_booking_apply",
    {
      _booking_id: booking.id,
      _cancellation_fee: fee,
      _refund_amount: booking.razorpay_payment_id ? refundAmount : 0,
      _refund_id: refundId,
      _refund_status: refundStatus,
    },
  );
  if (applyErr) {
    // At this point the Razorpay refund may already be in-flight. Log
    // loudly so ops can reconcile; still fail the request so the customer
    // sees the error and retries via support if needed.
    console.error(
      "[customer-cancel-booking] apply RPC failed after refund",
      { bookingId: booking.id, refundId, refundStatus, err: applyErr.message },
    );
    return json(500, {
      error: applyErr.message,
      refund_id: refundId,
      refund_status: refundStatus,
    });
  }

  return json(200, {
    ok: true,
    booking_id: booking.id,
    new_status: "cancelled",
    original_amount: originalAmount,
    cancellation_fee: fee,
    refund_amount: booking.razorpay_payment_id ? refundAmount : 0,
    refund_id: refundId,
    refund_status: refundStatus,
    apply: applyRes,
  });
});
