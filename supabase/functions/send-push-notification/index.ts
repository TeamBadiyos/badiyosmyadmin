// Internal-only Edge Function: send push notifications via FCM HTTP v1 API.
// SECURITY: This function MUST only be invoked with the service-role key
// (i.e. from other Edge Functions / DB triggers / server code). It intentionally
// does NOT verify a caller-supplied JWT and trusts the request body's user_id,
// so it must never be exposed to untrusted clients.
//
// verify_jwt is disabled in config.toml; access is gated by requiring the
// x-internal-secret header to equal SERVICE_ROLE_KEY (only trusted callers
// with the service role possess it).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SB_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY")!;

const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID");
const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL");
const FCM_PRIVATE_KEY = Deno.env.get("FCM_PRIVATE_KEY");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// --- Google OAuth2 access token from service-account JWT ---
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64UrlEncode(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getFcmAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  if (!FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY || !FCM_PROJECT_ID) {
    throw new Error("Missing FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: FCM_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claim),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(FCM_PRIVATE_KEY.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncode(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedAccessToken.token;
}

async function sendToToken(
  accessToken: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<{ ok: boolean; invalid: boolean; status: number; error?: string }> {
  const payload = {
    message: {
      token: fcmToken,
      notification: { title, body },
      data: data
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [
              k,
              typeof v === "string" ? v : JSON.stringify(v),
            ]),
          )
        : undefined,
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (res.ok) return { ok: true, invalid: false, status: res.status };
  const errText = await res.text();
  // FCM v1 returns UNREGISTERED / INVALID_ARGUMENT for stale tokens.
  const invalid =
    res.status === 404 ||
    /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(errText);
  return { ok: false, invalid, status: res.status, error: errText };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Gate: only trusted internal callers holding the service-role key.
  const internalSecret = req.headers.get("x-internal-secret");
  if (!SERVICE_ROLE_KEY || internalSecret !== SERVICE_ROLE_KEY) {
    return json(401, { error: "Unauthorized" });
  }

  let payload: {
    user_type?: string;
    user_id?: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { user_type, user_id, title, body, data } = payload;
  if (
    !user_type ||
    !["customer", "expert", "staff"].includes(user_type) ||
    !user_id ||
    !title ||
    !body
  ) {
    return json(400, { error: "Missing/invalid fields" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tokens, error: tokErr } = await admin
    .from("device_tokens")
    .select("id, fcm_token")
    .eq("user_type", user_type)
    .eq("user_id", user_id);

  if (tokErr) {
    console.error("[push] token lookup failed", tokErr);
    return json(200, { sent: 0, failed: 0, note: "token lookup failed" });
  }
  if (!tokens || tokens.length === 0) {
    return json(200, { sent: 0, failed: 0, note: "no tokens" });
  }

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken();
  } catch (e) {
    console.error("[push] FCM auth failed", e);
    return json(200, { sent: 0, failed: tokens.length, error: String(e) });
  }

  let sent = 0;
  let failed = 0;
  const invalidIds: string[] = [];

  await Promise.all(
    tokens.map(async (t) => {
      try {
        const r = await sendToToken(accessToken, t.fcm_token, title, body, data);
        if (r.ok) {
          sent++;
          await admin
            .from("device_tokens")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", t.id);
        } else {
          failed++;
          console.warn("[push] send failed", { id: t.id, status: r.status, error: r.error });
          if (r.invalid) invalidIds.push(t.id);
        }
      } catch (e) {
        failed++;
        console.error("[push] send exception", e);
      }
    }),
  );

  if (invalidIds.length > 0) {
    const { error: delErr } = await admin
      .from("device_tokens")
      .delete()
      .in("id", invalidIds);
    if (delErr) console.error("[push] cleanup failed", delErr);
  }

  return json(200, { sent, failed, cleaned: invalidIds.length });
});
