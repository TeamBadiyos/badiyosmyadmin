// PIN-based login for customers and experts.
//
// Flow:
//   1) Client posts { phone, pin, user_type: 'customer' | 'expert' }.
//   2) verify_login_pin RPC (service-role) checks lockout + bcrypt-hashed
//      pin_hash and, on success, returns the caller's auth.users id.
//      Failed attempts increment a per-phone counter; 5 fails => 15-minute
//      lockout. Success clears the counter.
//   3) On match we mint a session the same way the existing OTP-verify flow
//      does: `admin.generateLink({ type: 'sms', phone })` produces a fresh
//      one-time OTP hash the client verifies with `supabase.auth.verifyOtp`.
//      This reuses the exact GoTrue path the WhatsApp OTP login already
//      relies on, so no new session-minting surface is introduced.
//   4) On mismatch we always return the same 401 "Incorrect PIN" body —
//      never disclosing whether the phone number itself exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function normalizePhone(v: string): string {
  return (v || "").replace(/\D/g, "");
}

function toE164(digits: string): string {
  // GoTrue expects E.164. Default to India (+91) if a 10-digit local number
  // is given; otherwise prepend '+' to the raw digits.
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let payload: { phone?: string; pin?: string; user_type?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const phoneDigits = normalizePhone(payload.phone || "");
  const pin = (payload.pin || "").trim();
  const userType = payload.user_type;

  if (!phoneDigits || !/^\d{4}$/.test(pin) || (userType !== "customer" && userType !== "expert")) {
    return json(400, { error: "Invalid request" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("verify_login_pin", {
    p_phone: phoneDigits,
    p_pin: pin,
    p_user_type: userType,
  });

  if (error) {
    console.error("verify_login_pin error:", error);
    return json(500, { error: "Verification failed" });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const status = row?.status ?? "invalid";

  if (status === "locked") {
    return json(429, {
      error: "Too many failed attempts. Try again later.",
      retry_after_seconds: row?.retry_after_seconds ?? 900,
    });
  }
  if (status !== "ok" || !row?.auth_user_id) {
    return json(401, { error: "Incorrect PIN" });
  }

  // Mint session via GoTrue's SMS OTP path — same mechanism the existing
  // OTP-verify flow uses. Client then calls
  //   supabase.auth.verifyOtp({ phone, token, type: 'sms' })
  // to complete the session.
  const e164 = toE164(phoneDigits);
  const link = await admin.auth.admin.generateLink({
    type: "sms",
    phone: e164,
  });

  if (link.error || !link.data) {
    console.error("generateLink error:", link.error);
    return json(500, { error: "Could not mint session" });
  }

  return json(200, {
    ok: true,
    user_id: row.auth_user_id,
    phone: e164,
    // GoTrue returns the plaintext one-time token in properties.email_otp for
    // email and .hashed_token/.action_link for SMS; the client uses `token`
    // with verifyOtp. Return whichever is present.
    token:
      // deno-lint-ignore no-explicit-any
      (link.data as any).properties?.email_otp ??
      // deno-lint-ignore no-explicit-any
      (link.data as any).properties?.hashed_token ??
      null,
    verify_type: "sms",
  });
});
