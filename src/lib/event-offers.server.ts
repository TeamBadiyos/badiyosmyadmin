// Event Offers payments: reuses the same RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET
// secrets and Basic-auth REST pattern as the rest of the Badiyos backend.
import { createClient } from "@supabase/supabase-js";

function rzAuth() {
  const id = (process.env["RAZORPAY_KEY_ID"] ?? "").trim();
  const secret = (process.env["RAZORPAY_KEY_SECRET"] ?? "").trim();
  if (!id || !secret) throw new Error("Razorpay keys missing");
  return { id, secret, header: "Basic " + btoa(`${id}:${secret}`) };
}

export async function rz(path: string, body?: unknown) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: rzAuth().header, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Razorpay ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export function razorpayKeyId() {
  return rzAuth().id;
}

/** Supabase client acting as the caller (RLS + auth.uid()) from a Bearer JWT. */
export function userClient(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const url = process.env["SUPABASE_URL"]!;
  const key = (process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"])!;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hmacHex(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const expected = await hmacHex(rzAuth().secret, `${orderId}|${paymentId}`);
  return expected.length === signature.length && expected === signature;
}

/** Marks a Razorpay order paid after the payment is confirmed server-side. Idempotent. */
export async function markOfferPaid(orderId: string, paymentId: string) {
  const pay = await rz(`/payments/${paymentId}`);
  if (pay.order_id !== orderId || !["captured", "authorized"].includes(pay.status)) {
    return { ok: false, error: "PAYMENT_NOT_CAPTURED" };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // pay.amount is paise; the DB function converts/compares against rupees.
  const { data, error } = await supabaseAdmin.rpc("system_mark_offer_paid" as never, {
    _razorpay_order_id: orderId, _payment_id: paymentId, _amount_paise: pay.amount,
  } as never);
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; id?: string; status?: string; error?: string };
}

/** Refunds one redemption via Razorpay and records it. */
export async function refundRedemption(redemptionId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: r } = await supabaseAdmin.from("event_redemptions" as never)
    .select("id,status,amount,razorpay_payment_id").eq("id", redemptionId).maybeSingle();
  const row = r as { id: string; status: string; amount: number; razorpay_payment_id: string | null } | null;
  if (!row) return { ok: false, error: "NOT_FOUND" };
  if (!row.razorpay_payment_id || !["paid", "pending", "confirmed"].includes(row.status)) {
    return { ok: false, error: "NOT_REFUNDABLE" };
  }
  // row.amount is rupees; Razorpay refund API needs paise.
  const refund = await rz(`/payments/${row.razorpay_payment_id}/refund`, {
    amount: Math.round(Number(row.amount) * 100), speed: "normal", notes: { purpose: "event_offer", redemption_id: row.id },
  });
  await supabaseAdmin.rpc("system_mark_offer_refunded" as never, { _redemption_id: row.id, _refund_id: refund.id } as never);
  return { ok: true, refund_id: refund.id as string };
}
