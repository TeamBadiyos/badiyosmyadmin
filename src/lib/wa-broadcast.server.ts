// Server-only: AiSensy WhatsApp broadcast sending (same request format as the Customer App OTP sender).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AISENSY_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

/** Any phone text → 10-digit Indian mobile, or null. */
export function tenDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

type Recipient = { id: string; phone: string; name: string | null };
type Broadcast = {
  id: string;
  campaign_name: string;
  media_url: string | null;
  media_filename: string | null;
  params: unknown;
};

async function sendOne(apiKey: string, b: Broadcast, r: Recipient): Promise<string | null> {
  const d = tenDigits(r.phone);
  if (!d) return "Invalid phone";
  const name = r.name?.trim() || "";
  const params = (Array.isArray(b.params) ? b.params : []).map((p) =>
    String(p ?? "").split("{name}").join(name || "Customer"),
  );
  const body: Record<string, unknown> = {
    apiKey,
    campaignName: b.campaign_name,
    destination: `91${d}`,
    userName: name || "badiyos customer",
    templateParams: params,
  };
  if (b.media_url) body.media = { url: b.media_url, filename: b.media_filename || "image.jpg" };
  try {
    const res = await fetch(AISENSY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const t = (await res.text()).slice(0, 300);
    return `AiSensy ${res.status}: ${t}`;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 300) : "Network error";
  }
}

/** Sends pending recipients (100 per batch, 5 at a time) for up to ~20s. Returns pending left. */
export async function processBroadcast(broadcastId: string): Promise<number> {
  const apiKey = process.env["AISENSY_API_KEY"];
  if (!apiKey) throw new Error("AISENSY_API_KEY is not set");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: b, error } = await db
    .from("wa_broadcasts")
    .select("id, campaign_name, media_url, media_filename, params")
    .eq("id", broadcastId)
    .single();
  if (error || !b) throw new Error(error?.message ?? "Broadcast not found");
  await db.from("wa_broadcasts").update({ status: "sending" }).eq("id", broadcastId);

  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const { data: batch, error: cErr } = await db.rpc("wa_claim_pending", {
      _broadcast_id: broadcastId,
      _limit: 100,
    });
    if (cErr) throw new Error(cErr.message);
    const rows = (batch ?? []) as Recipient[];
    if (rows.length === 0) break;
    for (let i = 0; i < rows.length; i += 5) {
      const chunk = rows.slice(i, i + 5);
      await Promise.all(
        chunk.map(async (r) => {
          const err = await sendOne(apiKey, b as Broadcast, r);
          await db
            .from("wa_broadcast_recipients")
            .update(
              err
                ? { status: "failed", error: err }
                : { status: "sent", sent_at: new Date().toISOString(), error: null },
            )
            .eq("id", r.id)
            .eq("status", "pending");
        }),
      );
    }
    await db.rpc("wa_refresh_counts", { _broadcast_id: broadcastId });
  }
  await db.rpc("wa_refresh_counts", { _broadcast_id: broadcastId });
  const { count } = await db
    .from("wa_broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending");
  return count ?? 0;
}
