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
// Refund flow:
//   1. Fetch the payment from Razorpay to get the true captured amount
//      and validate that we're refunding a real, refundable payment.
//   2. Cap the refund at (captured amount - already refunded).
//   3. Attempt the refund. If Razorpay rejects, we STILL record the
//      cancellation with refund_status='failed' so the booking is not
//      left in a broken state — staff can then reconcile manually.

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

type RazorpayPayment = {
  id: string;
  status: string; // 'authorized' | 'captured' | 'refunded' | 'failed' | ...
  amount: number; // paise
  amount_refunded: number; // paise
  currency: string;
};

function basicAuthHeader(): string {
  return "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
}

async function fetchRazorpayPayment(paymentId: string): Promise<{
  ok: boolean;
  status: number;
  body: string;
  data?: RazorpayPayment;
}> {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    method: "GET",
    headers: { Authorization: basicAuthHeader() },
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body };
  try {
    return { ok: true, status: res.status, body, data: JSON.parse(body) };
  } catch {
    return { ok: false, status: res.status, body };
  }
}

async function razorpayRefund(
  paymentId: string,
  amountPaise: number,
  bookingId: string,
): Promise<{
  ok: boolean;
  status: number;
  requestBody: Record<string, unknown>;
  responseBody: string;
  data?: { id: string; status: string };
}> {
  const requestBody = {
    amount: amountPaise,
    speed: "normal",
    notes: { booking_id: bookingId, source: "customer_cancel" },
  };
  console.log("[customer-cancel-booking] razorpay refund request", {
    url: `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
    payment_id: paymentId,
    payload: requestBody,
  });
  const res = await fetch(
    `https://api.razorpay.com/v1/payments/${paymentId}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );
  const responseBody = await res.text();
  console.log("[customer-cancel-booking] razorpay refund response", {
    payment_id: paymentId,
    http_status: res.status,
    body: responseBody,
  });
  if (!res.ok) return { ok: false, status: res.status, requestBody, responseBody };
  try {
    const data = JSON.parse(responseBody) as { id: string; status: string };
    return { ok: true, status: res.status, requestBody, responseBody, data };
  } catch {
    return { ok: false, status: res.status, requestBody, responseBody };
  }
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
  let refundAmountRupees = Math.max(0, originalAmount - fee);

  let refundId: string | null = null;
  let refundStatus: string | null = null;
  let refundError: string | null = null;

  const paymentId = booking.razorpay_payment_id;

  if (refundAmountRupees > 0 && paymentId) {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return json(500, {
        error:
          "Razorpay credentials not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)",
      });
    }

    // Sanity check: the stored value must actually be a payment id.
    if (!paymentId.startsWith("pay_")) {
      refundStatus = "failed";
      refundError = `Invalid razorpay_payment_id on booking: ${paymentId}`;
      console.error("[customer-cancel-booking] invalid payment id", {
        booking_id: booking.id,
        razorpay_payment_id: paymentId,
      });
    } else {
      // Fetch the payment first — this both validates the id and gives
      // us the true captured amount so we never try to refund more than
      // was actually captured.
      const pay = await fetchRazorpayPayment(paymentId);
      console.log("[customer-cancel-booking] razorpay payment lookup", {
        payment_id: paymentId,
        http_status: pay.status,
        body: pay.body,
      });

      if (!pay.ok || !pay.data) {
        refundStatus = "failed";
        refundError = `Razorpay payment lookup failed (${pay.status}): ${pay.body}`;
      } else if (pay.data.status !== "captured") {
        refundStatus = "failed";
        refundError = `Payment not refundable — status=${pay.data.status}`;
      } else {
        const capturedPaise = pay.data.amount;
        const alreadyRefundedPaise = pay.data.amount_refunded ?? 0;
        const availablePaise = Math.max(0, capturedPaise - alreadyRefundedPaise);
        const requestedPaise = Math.round(refundAmountRupees * 100);
        const refundPaise = Math.min(requestedPaise, availablePaise);

        console.log("[customer-cancel-booking] refund amount computed", {
          booking_id: booking.id,
          original_amount_rupees: originalAmount,
          cancellation_fee_rupees: fee,
          requested_refund_paise: requestedPaise,
          captured_paise: capturedPaise,
          already_refunded_paise: alreadyRefundedPaise,
          available_paise: availablePaise,
          final_refund_paise: refundPaise,
        });

        if (refundPaise <= 0) {
          refundStatus = "failed";
          refundError = "No refundable amount remaining on payment";
        } else {
          refundAmountRupees = refundPaise / 100;
          const r = await razorpayRefund(paymentId, refundPaise, booking.id);
          if (r.ok && r.data) {
            refundId = r.data.id;
            refundStatus = r.data.status;
          } else {
            refundStatus = "failed";
            refundError = `Razorpay refund failed (${r.status}): ${r.responseBody}`;
            console.error("[customer-cancel-booking] refund failed", {
              booking_id: booking.id,
              payment_id: paymentId,
              http_status: r.status,
              request: r.requestBody,
              response: r.responseBody,
            });
          }
        }
      }
    }
  } else if (refundAmountRupees > 0 && !paymentId) {
    refundStatus = "no_payment_recorded";
  }

  // Apply the cancellation regardless of refund outcome — we don't want
  // to leave the booking in a broken half-cancelled state. If the refund
  // failed, we persist refund_status='failed' + refund_amount=0 so ops
  // can reconcile manually.
  const persistedRefundAmount =
    paymentId && refundStatus !== "failed" && refundStatus !== "no_payment_recorded"
      ? refundAmountRupees
      : 0;

  const { data: applyRes, error: applyErr } = await supabase.rpc(
    "customer_cancel_booking_apply",
    {
      _booking_id: booking.id,
      _cancellation_fee: fee,
      _refund_amount: persistedRefundAmount,
      _refund_id: refundId,
      _refund_status: refundStatus,
    },
  );
  if (applyErr) {
    console.error(
      "[customer-cancel-booking] apply RPC failed",
      {
        bookingId: booking.id,
        refundId,
        refundStatus,
        refundError,
        err: applyErr.message,
      },
    );
    return json(500, {
      error: applyErr.message,
      refund_id: refundId,
      refund_status: refundStatus,
      refund_error: refundError,
    });
  }

  return json(200, {
    ok: true,
    booking_id: booking.id,
    new_status: "cancelled",
    original_amount: originalAmount,
    cancellation_fee: fee,
    refund_amount: persistedRefundAmount,
    refund_id: refundId,
    refund_status: refundStatus,
    refund_error: refundError,
    apply: applyRes,
  });
});
