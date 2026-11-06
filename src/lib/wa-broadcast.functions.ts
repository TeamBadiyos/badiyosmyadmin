import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Role = "super_admin" | "ops_manager";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireWaStaff(supabase: any, userId: string): Promise<Role> {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  if (data.role !== "super_admin" && data.role !== "ops_manager") throw new Error("Forbidden");
  return data.role as Role;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

function mask(p: string | null, role: Role): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "").slice(-10);
  if (role === "super_admin") return d.length === 10 ? `+91${d}` : p;
  return d.length < 5 ? "xxxxx" : `${d.slice(0, 2)}xxxxx${d.slice(-3)}`;
}

function ten(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function activeCustomers(db: any): Promise<Array<{ id: string; phone: string; full_name: string | null }>> {
  const out: Array<{ id: string; phone: string; full_name: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("users")
      .select("id, phone, full_name")
      .is("deleted_at", null)
      .not("phone", "is", null)
      .order("created_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const content = z.object({
  campaign_name: z.string().trim().min(1).max(120),
  media_url: z.string().url().max(500).nullable().optional(),
  media_filename: z.string().max(120).nullable().optional(),
  params: z.array(z.string().max(500)).max(20).default([]),
});

export const getWaAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await requireWaStaff(context.supabase, context.userId);
    const db = await admin();
    const customers = await activeCustomers(db);
    const valid = new Set(customers.map((c) => ten(c.phone)).filter(Boolean));
    return { role, customerCount: valid.size };
  });

export const createWaBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    content
      .extend({
        include_all_customers: z.boolean(),
        extra_numbers: z.string().max(200_000).default(""),
        link_code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/i).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireWaStaff(context.supabase, context.userId);
    const db = await admin();
    const customers = await activeCustomers(db);
    const byPhone = new Map<string, { id: string; name: string | null }>();
    for (const c of customers) {
      const d = ten(c.phone);
      if (d && !byPhone.has(d)) byPhone.set(d, { id: c.id, name: c.full_name });
    }
    const recips = new Map<string, { customer_id: string | null; name: string | null }>();
    if (data.include_all_customers) {
      for (const [d, c] of byPhone) recips.set(d, { customer_id: c.id, name: c.name });
    }
    for (const part of data.extra_numbers.split(/[\s,;]+/)) {
      const d = part ? ten(part) : null;
      if (!d || recips.has(d)) continue;
      const c = byPhone.get(d);
      recips.set(d, { customer_id: c?.id ?? null, name: c?.name ?? null });
    }
    if (recips.size === 0) throw new Error("No valid numbers to send to");

    const { data: b, error } = await db
      .from("wa_broadcasts")
      .insert({
        campaign_name: data.campaign_name,
        media_url: data.media_url || null,
        media_filename: data.media_filename || null,
        params: data.params,
        include_all_customers: data.include_all_customers,
        link_code: data.link_code ? data.link_code.toLowerCase() : null,
        total: recips.size,
        status: "sending",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const rows = [...recips].map(([d, r]) => ({
      broadcast_id: b.id,
      phone: `+91${d}`,
      customer_id: r.customer_id,
      name: r.name,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await db.from("wa_broadcast_recipients").insert(rows.slice(i, i + 500));
      if (e) throw new Error(e.message);
    }
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      action: "wa_broadcast_create",
      target_table: "wa_broadcasts",
      target_id: b.id,
      before_state: null,
      after_state: { campaign_name: data.campaign_name, total: recips.size },
    });
    const { processBroadcast } = await import("./wa-broadcast.server");
    const pending = await processBroadcast(b.id);
    return { id: b.id as string, total: recips.size, pending };
  });

export const sendWaTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => content.extend({ phone: z.string().max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireWaStaff(context.supabase, context.userId);
    const d = ten(data.phone);
    if (!d) throw new Error("Enter a valid 10-digit mobile number");
    const db = await admin();
    const { data: u } = await db.from("users").select("id, full_name").like("phone", `%${d}`).is("deleted_at", null).limit(1).maybeSingle();
    const { data: b, error } = await db
      .from("wa_broadcasts")
      .insert({
        campaign_name: data.campaign_name,
        media_url: data.media_url || null,
        media_filename: data.media_filename || null,
        params: data.params,
        total: 1,
        is_test: true,
        status: "sending",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await db.from("wa_broadcast_recipients").insert({
      broadcast_id: b.id,
      phone: `+91${d}`,
      customer_id: u?.id ?? null,
      name: u?.full_name ?? null,
    });
    const { processBroadcast } = await import("./wa-broadcast.server");
    await processBroadcast(b.id);
    const { data: r } = await db.from("wa_broadcast_recipients").select("status, error").eq("broadcast_id", b.id).single();
    return { ok: r?.status !== "failed", error: (r?.error as string | null) ?? null };
  });

export const processWaBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireWaStaff(context.supabase, context.userId);
    const { processBroadcast } = await import("./wa-broadcast.server");
    return { pending: await processBroadcast(data.id) };
  });

export const retryWaFailed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireWaStaff(context.supabase, context.userId);
    const db = await admin();
    const { error } = await db
      .from("wa_broadcast_recipients")
      .update({ status: "pending", error: null, claimed_at: null })
      .eq("broadcast_id", data.id)
      .eq("status", "failed");
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      action: "wa_broadcast_retry",
      target_table: "wa_broadcasts",
      target_id: data.id,
      before_state: null,
      after_state: null,
    });
    const { processBroadcast } = await import("./wa-broadcast.server");
    return { pending: await processBroadcast(data.id) };
  });

export type WaBroadcastRow = {
  id: string;
  campaign_name: string;
  created_at: string;
  status: "queued" | "sending" | "done";
  is_test: boolean;
  total: number;
  sent: number;
  failed: number;
  link_code: string | null;
  delivered: number;
  read: number;
  replied: number;
  booked: number;
  clicks: number;
};

export const listWaBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaBroadcastRow[]> => {
    await requireWaStaff(context.supabase, context.userId);
    const db = await admin();
    await db.rpc("wa_attribute_bookings");
    const { data, error } = await db.rpc("wa_broadcast_list", { _limit: 100 });
    if (error) throw new Error(error.message);
    return (data ?? []) as WaBroadcastRow[];
  });

export type WaRecipientRow = {
  id: string;
  name: string | null;
  phone: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  reply_text: string | null;
  button_text: string | null;
  booked_at: string | null;
};

export const getWaRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireWaStaff(context.supabase, context.userId);
    const db = await admin();
    const rows: WaRecipientRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page, error } = await db
        .from("wa_broadcast_recipients")
        .select("id, name, phone, status, error, sent_at, delivered_at, read_at, replied_at, reply_text, button_text, booked_at")
        .eq("broadcast_id", data.id)
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of page ?? []) rows.push({ ...r, phone: mask(r.phone, role) });
      if (!page || page.length < 1000) break;
    }
    return { role, rows };
  });

export const listWaWebhookEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await requireWaStaff(context.supabase, context.userId);
    if (role !== "super_admin") throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("wa_webhook_events" as never)
      .select("id, received_at, event_type, phone, raw, signature_valid, matched_recipient_id")
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((e) => ({
      id: String(e.id),
      received_at: String(e.received_at),
      event_type: (e.event_type as string | null) ?? null,
      raw: JSON.stringify(e.raw ?? null, null, 2),
      signature_valid: !!e.signature_valid,
      matched_recipient_id: (e.matched_recipient_id as string | null) ?? null,
    }));
  });
