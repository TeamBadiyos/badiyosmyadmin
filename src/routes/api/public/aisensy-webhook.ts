// AiSensy webhook: delivery/read/failed statuses and customer replies for WhatsApp broadcasts.
// Signature (X-AiSensy-Signature = HMAC-SHA256 of raw body) is recorded but not yet enforced.
import { createFileRoute } from "@tanstack/react-router";

type J = Record<string, unknown>;
const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Depth-first search for the first string value whose key matches. */
function find(o: unknown, keys: RegExp, depth = 0): string | null {
  if (!o || typeof o !== "object" || depth > 6) return null;
  for (const [k, v] of Object.entries(o as J)) {
    if (keys.test(k) && (typeof v === "string" || typeof v === "number") && String(v).trim()) return String(v);
  }
  for (const v of Object.values(o as J)) {
    const r = find(v, keys, depth + 1);
    if (r) return r;
  }
  return null;
}

function tenDigits(raw: string | null) {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const Route = createFileRoute("/api/public/aisensy-webhook")({
  server: {
    handlers: {
      GET: async () => new Response("ok"),
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 200_000) return new Response("too large", { status: 413 });
        const secret = process.env["AISENSY_WEBHOOK_SECRET"];
        const given = (request.headers.get("x-aisensy-signature") ?? "").replace(/^sha256=/i, "").trim().toLowerCase();
        let signatureValid = false;
        if (secret && given) signatureValid = safeEq(await hmacHex(secret, raw), given);

        let payload: J = {};
        try { payload = JSON.parse(raw) as J; } catch { payload = { _raw: raw }; }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;

        const eventType = find(payload, /^(topic|event|eventType|event_type|type)$/i);
        const statusRaw = (find(payload, /^(status|message_status|messageStatus|deliveryStatus)$/i) ?? "").toLowerCase();
        const d = tenDigits(find(payload, /^(phone|phone_number|phoneNumber|destination|waId|wa_id|from|mobile|recipient_id|to|userNumber)$/i));
        const buttonText =
          find(payload, /^(button_text|buttonText)$/i) ??
          (find(payload, /button/i) ? find((payload as J), /^(title|text|payload)$/i) : null);
        const lowerType = (eventType ?? "").toLowerCase();
        const isIncoming = /incoming|inbound|received|user_message|message\.created|reply/.test(lowerType) ||
          (!statusRaw && !!find(payload, /^(text|body|message)$/i));
        const replyText = isIncoming ? find(payload, /^(text|body|message|caption)$/i) : null;

        let matchedId: string | null = null;
        if (d) {
          const since = new Date(Date.now() - 72 * 3600_000).toISOString();
          const { data: rec } = await db
            .from("wa_broadcast_recipients")
            .select("id, status, delivered_at, read_at, replied_at, button_text")
            .eq("phone", `+91${d}`)
            .gte("sent_at", since)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (rec) {
            matchedId = rec.id;
            const now = new Date().toISOString();
            const upd: J = {};
            const cur = RANK[rec.status] ?? -1;
            if (statusRaw.includes("read")) {
              if (!rec.read_at) upd.read_at = now;
              if (!rec.delivered_at) upd.delivered_at = now;
              if (rec.status !== "failed" && cur < 3) upd.status = "read";
            } else if (statusRaw.includes("deliver")) {
              if (!rec.delivered_at) upd.delivered_at = now;
              if (rec.status !== "failed" && cur < 2) upd.status = "delivered";
            } else if (statusRaw.includes("fail")) {
              if (cur < 2) {
                upd.status = "failed";
                upd.error = (find(payload, /^(error|reason|failureReason|message)$/i) ?? "Failed").slice(0, 300);
              }
            }
            if (isIncoming && !rec.replied_at) {
              upd.replied_at = now;
              if (replyText) upd.reply_text = replyText.slice(0, 500);
            }
            if (isIncoming && buttonText && !rec.button_text) upd.button_text = buttonText.slice(0, 200);
            if (Object.keys(upd).length) {
              await db.from("wa_broadcast_recipients").update(upd).eq("id", rec.id);
            }
          }
        }

        await db.from("wa_webhook_events").insert({
          event_type: eventType ?? (statusRaw || null),
          phone: d ? `+91${d}` : null,
          raw: payload,
          signature_valid: signatureValid,
          matched_recipient_id: matchedId,
        });
        return new Response("ok");
      },
    },
  },
});
