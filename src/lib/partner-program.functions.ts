import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PartnerProgram = "growth" | "zone_franchise" | "city_master";

export type PartnerRow = {
  id: string;
  name: string;
  phone: string;
  program: PartnerProgram;
  level: string | null;
  plan_id: string | null;
  fee_collected_at: string | null;
  city: string;
  zone_id: string | null;
  agreement_start: string;
  agreement_end: string;
  fee_paid: number;
  status: "active" | "inactive";
  notes: string | null;
};

export type PlanLine = { plan_id?: string; line_key: string; enabled: boolean; pct: number };
export type CommissionPlan = {
  id: string;
  name: string;
  partner_type: PartnerProgram;
  suggested_fee: number;
  sort_order: number;
  status: "active" | "inactive";
  lines: PlanLine[];
  partnerCount: number;
};

export const saveCommissionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; name: string; partner_type: PartnerProgram; suggested_fee: number; sort_order: number; status: string; lines: PlanLine[] }) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, true);
    const id = await rpc(context.supabase, "staff_partner_plan_upsert", { _p: data });
    return { id: id as string };
  });

async function requireStaff(db: Db, userId: string, write: boolean) {
  const { data, error } = await db
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const allowed = write ? ["super_admin"] : ["super_admin", "ops_manager"];
  if (!data || data.status !== "active" || !allowed.includes(data.role)) {
    throw new Error(write ? "Only Super Admin can change the Partner Program" : "Forbidden");
  }
}

async function rpc(db: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export const getPartnerProgram = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    await requireStaff(db, context.userId, false);
    const [s, p, z, e, pl, ln, bl] = await Promise.all([
      db.from("partner_program_settings").select("*").eq("id", 1).maybeSingle(),
      db.from("partners").select("*").order("created_at", { ascending: false }),
      db.from("zones").select("id, name, city").is("deleted_at", null).order("name"),
      db.from("experts").select("onboarded_by_partner_id").not("onboarded_by_partner_id", "is", null),
      db.from("partner_commission_plans").select("*").order("sort_order").order("name"),
      db.from("partner_plan_lines").select("*"),
      db.from("partner_business_lines").select("*").order("sort_order"),
    ]);
    for (const r of [s, p, z, e, pl, ln, bl]) if (r.error) throw new Error(r.error.message);
    const expertCounts: Record<string, number> = {};
    for (const r of e.data ?? []) expertCounts[r.onboarded_by_partner_id] = (expertCounts[r.onboarded_by_partner_id] ?? 0) + 1;
    return {
      settings: s.data as Record<string, number | boolean>,
      partners: (p.data ?? []) as PartnerRow[],
      zones: (z.data ?? []) as { id: string; name: string; city: string }[],
      expertCounts,
      businessLines: (bl.data ?? []) as { key: string; label: string }[],
      plans: ((pl.data ?? []) as Omit<CommissionPlan, "lines" | "partnerCount">[]).map((x) => ({
        ...x,
        lines: ((ln.data ?? []) as PlanLine[]).filter((l) => l.plan_id === x.id),
        partnerCount: ((p.data ?? []) as PartnerRow[]).filter((r) => r.plan_id === x.id).length,
      })) as CommissionPlan[],
    };
  });

export const updatePartnerSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Record<string, number>) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, true);
    await rpc(context.supabase, "staff_partner_update_settings", { _p: data });
    return { ok: true };
  });

export const togglePartnerProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { program: "master" | PartnerProgram; enabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, true);
    await rpc(context.supabase, "staff_partner_toggle", { _program: data.program, _enabled: data.enabled });
    return { ok: true };
  });

export const savePartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Partial<PartnerRow>) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, true);
    const id = await rpc(context.supabase, "staff_partner_upsert", { _p: data });
    return { id: id as string };
  });

export const listGrowthPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    await requireStaff(db, context.userId, false);
    const { data, error } = await db.from("partners").select("id, name, status, partner_commission_plans(name)").eq("program", "growth").order("name");
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({ id: r.id as string, name: r.name as string, status: r.status as string, level: (r.partner_commission_plans?.name ?? "No plan") as string }));
  });

export const getExpertGrowthPartner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { expertId: string }) => d)
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireStaff(db, context.userId, false);
    const { data: row, error } = await db.from("experts").select("onboarded_by_partner_id").eq("id", data.expertId).maybeSingle();
    if (error) throw new Error(error.message);
    return { partnerId: (row?.onboarded_by_partner_id as string | null) ?? null };
  });

export const setExpertGrowthPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { expertId: string; partnerId: string | null }) => d)
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId, true);
    await rpc(context.supabase, "staff_set_expert_growth_partner", { _expert_id: data.expertId, _partner_id: data.partnerId });
    return { ok: true };
  });

export const listPartnerBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    await requireStaff(db, context.userId, false);
    const { data, error } = await db.from("partner_payout_batches").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getPartnerBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireStaff(db, context.userId, false);
    const [b, i, l] = await Promise.all([
      db.from("partner_payout_batches").select("*").eq("id", data.batchId).maybeSingle(),
      db.from("partner_payout_items").select("*, partners(name, phone, program, partner_commission_plans(name))").eq("batch_id", data.batchId),
      db.from("partner_payout_lines").select("*").eq("batch_id", data.batchId).order("order_completed_at"),
    ]);
    for (const r of [b, i, l]) if (r.error) throw new Error(r.error.message);
    return { batch: b.data, items: i.data ?? [], lines: l.data ?? [] };
  });

type Act =
  | { kind: "generate"; from: string; to: string; notes?: string }
  | { kind: "editLine"; id: string; amount: number; reason: string }
  | { kind: "deleteLine"; id: string; reason: string }
  | { kind: "deleteItem"; id: string; reason: string }
  | { kind: "deleteBatch"; id: string; reason: string }
  | { kind: "approve"; id: string }
  | { kind: "markPaid"; id: string; paidOn: string; reference?: string };

export const partnerPayoutAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Act) => d)
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    await requireStaff(db, context.userId, true);
    switch (data.kind) {
      case "generate":
        return { id: (await rpc(db, "staff_partner_generate_payout", { _from: data.from, _to: data.to, _notes: data.notes ?? null })) as string };
      case "editLine":
        await rpc(db, "staff_partner_line_edit", { _line_id: data.id, _amount: data.amount, _reason: data.reason });
        break;
      case "deleteLine":
        await rpc(db, "staff_partner_line_delete", { _line_id: data.id, _reason: data.reason });
        break;
      case "deleteItem":
        await rpc(db, "staff_partner_item_delete", { _item_id: data.id, _reason: data.reason });
        break;
      case "deleteBatch":
        await rpc(db, "staff_partner_batch_delete", { _batch_id: data.id, _reason: data.reason });
        break;
      case "approve":
        await rpc(db, "staff_partner_batch_approve", { _batch_id: data.id });
        break;
      case "markPaid":
        await rpc(db, "staff_partner_batch_mark_paid", { _batch_id: data.id, _paid_on: data.paidOn, _reference: data.reference ?? null });
        break;
    }
    return { id: null as string | null };
  });
