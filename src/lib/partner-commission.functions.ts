import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Role = "super_admin" | "ops_manager";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireStaff(supabase: any, userId: string, roles: Role[]) {
  const { data } = await supabase
    .from("staff_users").select("role, status").eq("auth_user_id", userId).maybeSingle();
  if (!data || data.status !== "active" || !roles.includes(data.role)) throw new Error("Aapko is action ki permission nahi hai.");
}
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

export type CommissionOrder = {
  id: string;
  created_at: string;
  completed_at: string;
  service_label: string;
  zone_name: string;
  amount: number;
  commission: number;
  locked: boolean; // already in another saved batch
};

export type CommissionBatch = {
  id: string;
  partner_id: string;
  partner_name: string;
  week_start: string;
  week_end: string;
  status: string;
  total_amount: number;
  notes: string | null;
  created_at: string;
  booking_ids: string[];
  paid: boolean;
  paid_on: string | null;
  utr: string | null;
  payment_mode: string | null;
};

export const getCommissionOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const db = await admin();
    const { data: partners } = await db.from("area_partners").select("id, name, status, deleted_at").is("deleted_at", null);
    const { data: svc } = await db.from("bookings").select("service_label").eq("status", "completed").eq("is_training", false).not("service_label", "is", null).limit(5000);
    const services = Array.from(new Set((svc ?? []).map((s) => s.service_label as string))).sort();
    return { partners: (partners ?? []).map((p) => ({ id: p.id as string, name: p.name as string, active: p.status === "active" })), services };
  });

async function lockedBookingIds(db: Awaited<ReturnType<typeof admin>>, partnerId: string, excludeBatch?: string) {
  const { data: batches } = await db.from("payout_batches").select("id").eq("batch_type", "area_partner").neq("status", "discarded");
  const ids = (batches ?? []).map((b) => b.id).filter((id) => id !== excludeBatch);
  if (!ids.length) return new Set<string>();
  const { data: items } = await db.from("payout_batch_items").select("booking_ids").in("batch_id", ids).eq("owner_id", partnerId).eq("removed", false);
  return new Set((items ?? []).flatMap((i) => i.booking_ids ?? []));
}

export const previewPartnerCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partnerId: string; start: string; end: string; services: string[]; batchId?: string }) => d)
  .handler(async ({ data, context }): Promise<CommissionOrder[]> => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const db = await admin();
    const { data: zones } = await db.from("zones").select("id, name").eq("assigned_area_partner_id", data.partnerId);
    const zoneMap = new Map((zones ?? []).map((z) => [z.id as string, z.name as string]));
    if (!zoneMap.size) return [];
    let q = db.from("bookings")
      .select("id, created_at, service_end_at, updated_at, service_label, zone_id, total_amount, snapshot_partner_payout, razorpay_payment_id")
      .eq("status", "completed").eq("is_training", false).is("deleted_at", null)
      .in("zone_id", Array.from(zoneMap.keys()))
      .gte("updated_at", `${data.start}T00:00:00+05:30`).lte("updated_at", `${data.end}T23:59:59.999+05:30`)
      .order("updated_at").limit(5000);
    if (data.services.length) q = q.in("service_label", data.services);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const locked = await lockedBookingIds(db, data.partnerId, data.batchId);
    return (rows ?? []).map((r) => {
      const free = String(r.razorpay_payment_id ?? "").startsWith("free_");
      return {
        id: r.id as string,
        created_at: r.created_at as string,
        completed_at: (r.service_end_at ?? r.updated_at) as string,
        service_label: (r.service_label as string) ?? "—",
        zone_name: zoneMap.get(r.zone_id as string) ?? "—",
        amount: Number(r.total_amount ?? 0),
        commission: free ? 0 : Number(r.snapshot_partner_payout ?? 0),
        locked: locked.has(r.id as string),
      };
    });
  });

export const savePartnerCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId?: string; partnerId: string; start: string; end: string; bookingIds: string[]; notes?: string }) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    if (!data.bookingIds.length) throw new Error("Kam se kam ek order select karein.");
    if (data.end < data.start) throw new Error("End date start date se pehle nahi ho sakti.");
    const db = await admin();
    const locked = await lockedBookingIds(db, data.partnerId, data.batchId);
    if (data.bookingIds.some((id) => locked.has(id))) throw new Error("Kuch orders pehle se dusre commission batch me save hain.");
    const { data: bks } = await db.from("bookings").select("id, snapshot_partner_payout, razorpay_payment_id").in("id", data.bookingIds);
    const total = (bks ?? []).reduce((s, b) => s + (String(b.razorpay_payment_id ?? "").startsWith("free_") ? 0 : Number(b.snapshot_partner_payout ?? 0)), 0);
    let batchId = data.batchId;
    let before: unknown = null;
    if (batchId) {
      const { data: b } = await db.from("payout_batches").select("*").eq("id", batchId).maybeSingle();
      if (!b || b.batch_type !== "area_partner") throw new Error("Batch nahi mila.");
      if (b.status !== "pending") throw new Error("Sirf pending batch edit ho sakta hai. Paid ho to pehle unmark karein.");
      before = b;
      await db.from("payout_batches").update({ week_start: data.start, week_end: data.end, total_amount: total, notes: data.notes ?? null }).eq("id", batchId);
      await db.from("payout_batch_items").update({ booking_ids: data.bookingIds, amount: total, gross_amount: total, net_amount: total }).eq("batch_id", batchId);
    } else {
      const { data: b, error } = await db.from("payout_batches").insert({ batch_type: "area_partner", status: "pending", week_start: data.start, week_end: data.end, total_amount: total, notes: data.notes ?? null }).select("id").single();
      if (error) throw new Error(error.message);
      batchId = b.id;
      const { error: e2 } = await db.from("payout_batch_items").insert({ batch_id: batchId!, owner_type: "area_partner", owner_id: data.partnerId, booking_ids: data.bookingIds, amount: total, gross_amount: total, net_amount: total });
      if (e2) throw new Error(e2.message);
    }
    await db.from("audit_logs").insert({ actor_id: context.userId, action: data.batchId ? "partner_commission_edit" : "partner_commission_create", target_table: "payout_batches", target_id: batchId, before_state: before as never, after_state: { ...data, total } as never });
    return { id: batchId!, total };
  });

export const listPartnerCommissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CommissionBatch[]> => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const db = await admin();
    const { data: batches } = await db.from("payout_batches").select("*").eq("batch_type", "area_partner").order("created_at", { ascending: false }).limit(200);
    const ids = (batches ?? []).map((b) => b.id);
    if (!ids.length) return [];
    const { data: items } = await db.from("payout_batch_items").select("*").in("batch_id", ids);
    const pids = Array.from(new Set((items ?? []).map((i) => i.owner_id)));
    const { data: ps } = pids.length ? await db.from("area_partners").select("id, name").in("id", pids) : { data: [] };
    const pName = new Map((ps ?? []).map((p) => [p.id, p.name as string]));
    return (batches ?? []).map((b) => {
      const it = (items ?? []).find((i) => i.batch_id === b.id);
      return {
        id: b.id, partner_id: it?.owner_id ?? "", partner_name: pName.get(it?.owner_id ?? "") ?? "—",
        week_start: b.week_start, week_end: b.week_end, status: b.status, total_amount: Number(b.total_amount ?? 0),
        notes: b.notes, created_at: b.created_at, booking_ids: it?.booking_ids ?? [],
        paid: !!it?.paid, paid_on: it?.paid_on ?? null, utr: it?.utr ?? null, payment_mode: it?.payment_mode ?? null,
      };
    });
  });

export const updatePartnerCommissionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; action: "discard" | "paid" | "unpaid"; reason?: string; paidOn?: string; utr?: string; mode?: string }) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, ["super_admin", "ops_manager"]);
    const db = await admin();
    const { data: b } = await db.from("payout_batches").select("*").eq("id", data.batchId).maybeSingle();
    if (!b || b.batch_type !== "area_partner") throw new Error("Batch nahi mila.");
    if (data.action === "discard") {
      if (b.status === "paid") throw new Error("Paid batch delete nahi ho sakta. Pehle unmark karein.");
      if (!data.reason?.trim()) throw new Error("Reason zaroori hai.");
      await db.from("payout_batches").update({ status: "discarded", notes: `${b.notes ? b.notes + " | " : ""}Deleted: ${data.reason}` }).eq("id", b.id);
    } else if (data.action === "paid") {
      if (b.status !== "pending") throw new Error("Sirf pending batch paid mark ho sakta hai.");
      if (!data.paidOn) throw new Error("Payment date zaroori hai.");
      const now = new Date().toISOString();
      await db.from("payout_batch_items").update({ paid: true, paid_at: now, paid_on: data.paidOn, utr: data.utr ?? null, payment_mode: data.mode ?? null }).eq("batch_id", b.id);
      await db.from("payout_batches").update({ status: "paid", paid_at: now }).eq("id", b.id);
    } else {
      if (b.status !== "paid") throw new Error("Batch paid nahi hai.");
      await db.from("payout_batch_items").update({ paid: false, paid_at: null, paid_on: null, utr: null, payment_mode: null }).eq("batch_id", b.id);
      await db.from("payout_batches").update({ status: "pending", paid_at: null }).eq("id", b.id);
    }
    await db.from("audit_logs").insert({ actor_id: context.userId, action: `partner_commission_${data.action}`, target_table: "payout_batches", target_id: b.id, before_state: b as never, after_state: data as never });
    return { ok: true };
  });
