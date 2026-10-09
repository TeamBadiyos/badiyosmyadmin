import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireFinance(supabase: any, userId: string) {
  const { data } = await supabase.from("staff_users").select("id, role, status").eq("auth_user_id", userId).maybeSingle();
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) throw new Error("Forbidden");
  return data;
}

export const listSettlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { from: string; to: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: rows, error } = await sb.from("gateway_settlements").select("*")
      .gte("settled_at", `${data.from}T00:00:00+05:30`).lte("settled_at", `${data.to}T23:59:59+05:30`)
      .order("settled_at", { ascending: false }).limit(1000);
    if (error) throw new Error(error.message);
    const { data: last } = await sb.from("gateway_sync_log").select("*").order("created_at", { ascending: false }).limit(1);
    return { rows: rows ?? [], lastSync: last?.[0] ?? null };
  });

export const listSettlementItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { settlementId: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (context.supabase as any).from("gateway_settlement_items").select("*")
      .eq("settlement_id", data.settlementId).order("txn_at").limit(2000);
    return rows ?? [];
  });

export const syncSettlementsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncRazorpaySettlements } = await import("@/lib/razorpay-settlements.server");
    return syncRazorpaySettlements(supabaseAdmin, "manual", Math.min(Math.max(data.days ?? 30, 1), 90));
  });

export const setSettlementTally = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reconciled: boolean; note?: string }) => d)
  .handler(async ({ data, context }) => {
    const staff = await requireFinance(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data: before } = await admin.from("gateway_settlements").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("Settlement not found");
    const patch = {
      bank_reconciled: data.reconciled,
      bank_reconciled_at: data.reconciled ? new Date().toISOString() : null,
      bank_reconciled_by: data.reconciled ? context.userId : null,
      bank_reference_note: data.note?.slice(0, 300) ?? null,
    };
    const { error } = await admin.from("gateway_settlements").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await admin.from("audit_logs").insert({
      actor_id: staff.id, action: data.reconciled ? "settlement_bank_tallied" : "settlement_bank_untallied",
      entity_type: "gateway_settlement", before_value: before, after_value: { ...before, ...patch },
    }).then(() => null, () => null);
    return { ok: true };
  });
