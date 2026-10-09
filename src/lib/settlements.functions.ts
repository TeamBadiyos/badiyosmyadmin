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
    const ids = (rows ?? []).map((r: { id: string }) => r.id);
    const agg: Record<string, { gross: number; fees: number; tax: number; refunds: number; n: number }> = {};
    for (let i = 0; i < ids.length; i += 100) {
      const { data: items } = await sb.from("gateway_settlement_items").select("settlement_id,type,amount,fee,tax,debit")
        .in("settlement_id", ids.slice(i, i + 100)).limit(10000);
      for (const it of (items ?? []) as Array<Record<string, number | string>>) {
        const a = (agg[it.settlement_id as string] ??= { gross: 0, fees: 0, tax: 0, refunds: 0, n: 0 });
        const fee = Number(it.fee || 0), debit = Number(it.debit || 0);
        if (it.type === "payment") { a.gross += Number(it.amount || 0); a.n++; }
        a.fees += fee; a.tax += Number(it.tax || 0);
        if (debit > 0) a.refunds += debit - fee;
      }
    }
    const r2 = (n: number) => +n.toFixed(2);
    const out = (rows ?? []).map((r: Record<string, unknown>) => {
      const a = agg[r.id as string];
      if (!a) return { ...r, refunds: 0, payments_count: 0, has_items: false };
      return { ...r, gross_amount: r2(a.gross), fees: r2(a.fees), tax: r2(a.tax), refunds: r2(a.refunds), payments_count: a.n, has_items: true };
    });
    const { data: last } = await sb.from("gateway_sync_log").select("*").order("created_at", { ascending: false }).limit(1);
    return { rows: out, lastSync: last?.[0] ?? null };
  });

export const listSettlementItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { settlementId: string }) => d)
  .handler(async ({ data, context }) => {
    await requireFinance(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: rows } = await sb.from("gateway_settlement_items").select("*")
      .eq("settlement_id", data.settlementId).order("txn_at").limit(2000);
    const items = (rows ?? []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!items.length) return [];
    const ent = [...new Set(items.map((i) => i.entity_id).filter(Boolean))] as string[];
    const ord = [...new Set(items.map((i) => i.order_id).filter(Boolean))] as string[];
    const [bp, bo, ex, tp] = await Promise.all([
      sb.from("bookings").select("user_id, razorpay_payment_id, razorpay_order_id").in("razorpay_payment_id", ent),
      ord.length ? sb.from("bookings").select("user_id, razorpay_payment_id, razorpay_order_id").in("razorpay_order_id", ord) : { data: [] },
      sb.from("booking_extensions").select("booking_id, razorpay_payment_id").in("razorpay_payment_id", ent),
      sb.from("booking_tips").select("user_id, razorpay_payment_id").in("razorpay_payment_id", ent),
    ]);
    const byPay = new Map<string, string>(), byOrder = new Map<string, string>();
    for (const b of [...(bp.data ?? []), ...(bo.data ?? [])]) {
      if (b.razorpay_payment_id) byPay.set(b.razorpay_payment_id, b.user_id);
      if (b.razorpay_order_id) byOrder.set(b.razorpay_order_id, b.user_id);
    }
    for (const t of tp.data ?? []) byPay.set(t.razorpay_payment_id, t.user_id);
    const extB = (ex.data ?? []) as Array<{ booking_id: string; razorpay_payment_id: string }>;
    if (extB.length) {
      const { data: eb } = await sb.from("bookings").select("id, user_id").in("id", extB.map((e) => e.booking_id));
      const m = new Map((eb ?? []).map((b: { id: string; user_id: string }) => [b.id, b.user_id]));
      for (const e of extB) { const u = m.get(e.booking_id); if (u) byPay.set(e.razorpay_payment_id, u as string); }
    }
    const uidOf = (i: Record<string, string>) => byPay.get(i.entity_id) ?? (i.order_id ? byOrder.get(i.order_id) : undefined);
    // Fallback: payer phone from Razorpay for anything not linked (extensions, courier, etc.)
    const { razorpayContact } = await import("@/lib/razorpay-settlements.server");
    const missing = items.filter((i) => !uidOf(i)).slice(0, 40);
    const contacts = new Map<string, string>();
    await Promise.all(missing.map(async (i) => { const c = await razorpayContact(i.entity_id); if (c) contacts.set(i.entity_id, c); }));
    const p10 = (p: string) => p.replace(/\D/g, "").slice(-10);
    const phones = [...new Set([...contacts.values()].map(p10))];
    const uids = [...new Set(items.map(uidOf).filter(Boolean))] as string[];
    const [ur, pr] = await Promise.all([
      uids.length ? sb.from("users").select("id, full_name, phone").in("id", uids) : { data: [] },
      phones.length ? sb.from("users").select("id, full_name, phone").in("phone", phones.flatMap((p) => [p, `+91${p}`])) : { data: [] },
    ]);
    type U = { id: string; full_name: string | null; phone: string | null };
    const uMap = new Map<string, U>((ur.data ?? []).map((u: U) => [u.id, u]));
    const pMap = new Map<string, U>((pr.data ?? []).map((u: U) => [p10(u.phone ?? ""), u]));
    return items.map((i) => {
      const id = uidOf(i);
      const c = contacts.get(i.entity_id);
      const u = id ? uMap.get(id) : c ? pMap.get(p10(c)) : undefined;
      return { ...i, customer_name: u?.full_name ?? null, customer_phone: u?.phone ?? c ?? null };
    });
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
      target_table: "gateway_settlements", target_id: null, before_state: before, after_state: { ...before, ...patch },
    }).then(() => null, () => null);
    return { ok: true };
  });
