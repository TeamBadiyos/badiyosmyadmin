import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };

async function requireOpsStaff(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc("courier_is_ops_staff");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not allowed");
}

export type LeftBehindPacket = {
  code: string; printed: string; drop_label: string | null; receiver: string | null;
  reason: string; notes: string | null; removed_by: string; removed_by_label: string; removed_at: string;
};
export type LeftBehindRemoval = {
  removal_id: string; removed_at: string; fare_before: number | null; fare_after: number | null;
  refund: number | null; trip_cancelled: boolean; packets: LeftBehindPacket[];
};

const printed = (c: string) => (/^[0-9]{7}$/.test(c) ? `${c.slice(0, 6)}-${c.slice(6)}` : c);
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Removed packets for one courier order (trip), grouped per removal with fare before/after + refund. */
export const getTripLeftBehind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { courier_order_id: string }) => i)
  .handler(async ({ data: i, context }): Promise<{ trip_no: number | null; removals: LeftBehindRemoval[] }> => {
    const ctx = context as Ctx;
    await requireOpsStaff(ctx);
    const db = ctx.supabase;
    const { data: rows, error } = await db.from("business_trip_removed_packets")
      .select("removal_id, batch_id, receiver_id, drop_label, code, reason_code, notes, removed_by, removed_by_id, removed_at")
      .eq("courier_order_id", i.courier_order_id).order("removed_at");
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    if (!list.length) return { trip_no: null, removals: [] };
    const batchIds = [...new Set(list.map((r) => r.batch_id).filter(Boolean))];
    const recIds = [...new Set(list.map((r) => r.receiver_id).filter(Boolean))];
    const riderIds = [...new Set(list.filter((r) => r.removed_by === "rider" && r.removed_by_id).map((r) => r.removed_by_id))];
    const [bt, rc, ex, au, ev] = await Promise.all([
      batchIds.length ? db.from("business_batches").select("id, trip_no").in("id", batchIds) : { data: [] },
      recIds.length ? db.from("business_receivers").select("id, name").in("id", recIds) : { data: [] },
      riderIds.length ? db.from("experts").select("id, auth_user_id, name").or(`auth_user_id.in.(${riderIds.join(",")}),id.in.(${riderIds.join(",")})`) : { data: [] },
      batchIds.length ? db.from("audit_logs").select("*").eq("action", "trip_packets_removed").in("entity_id", batchIds) : { data: [] },
      db.from("courier_order_events").select("meta, created_at").eq("order_id", i.courier_order_id),
    ]);
    const recName = new Map(((rc.data ?? []) as any[]).map((r) => [r.id, r.name]));
    const riderName = new Map<string, string>();
    for (const e of (ex.data ?? []) as any[]) { riderName.set(e.id, e.name); if (e.auth_user_id) riderName.set(e.auth_user_id, e.name); }
    // audit rows: find new/old json fields generically
    const audits = ((au.data ?? []) as any[]).map((a) => {
      const nv = a.new_data ?? a.new_values ?? a.after ?? a.details ?? {};
      const ov = a.old_data ?? a.old_values ?? a.before ?? {};
      return { nv, ov };
    });
    const events = ((ev.data ?? []) as any[]).filter((e) => e.meta?.event === "packets_removed");
    const groups = new Map<string, any[]>();
    for (const r of list) { if (!groups.has(r.removal_id)) groups.set(r.removal_id, []); groups.get(r.removal_id)!.push(r); }
    const removals: LeftBehindRemoval[] = [...groups.entries()].map(([rid, ps]) => {
      const codes = ps.map((p) => p.code).sort().join(",");
      const matchCodes = (c: unknown) => Array.isArray(c) && [...c].sort().join(",") === codes;
      const a = audits.find((x) => x.nv?.removal_id === rid) ?? audits.find((x) => matchCodes(x.nv?.codes));
      const e = events.find((x) => matchCodes(x.meta?.codes));
      const all = !!(a?.nv?.all ?? e?.meta?.all);
      const refund = num(a?.nv?.refund ?? e?.meta?.refund);
      const after = num(a?.nv?.new_total ?? e?.meta?.new_total);
      const before = num(a?.ov?.total_amount) ?? (after != null && refund != null ? Math.round((after + refund) * 100) / 100 : null);
      return {
        removal_id: rid, removed_at: ps[0].removed_at, fare_before: before, fare_after: all ? 0 : after,
        refund, trip_cancelled: all,
        packets: ps.map((p) => ({
          code: p.code, printed: printed(p.code), drop_label: p.drop_label, receiver: recName.get(p.receiver_id) ?? null,
          reason: String(p.reason_code ?? "—"), notes: p.notes, removed_by: p.removed_by, removed_at: p.removed_at,
          removed_by_label: p.removed_by === "rider" ? (riderName.get(p.removed_by_id) ?? "Rider") : p.removed_by === "business" ? "Business" : String(p.removed_by ?? "—"),
        })),
      };
    });
    return { trip_no: num(((bt.data ?? []) as any[])[0]?.trip_no), removals };
  });

/** Count of removed packets per batch id (trip list tag). */
export const getLeftBehindCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { batch_ids: string[] }) => i)
  .handler(async ({ data: i, context }): Promise<Record<string, number>> => {
    const ctx = context as Ctx;
    await requireOpsStaff(ctx);
    if (!i.batch_ids.length) return {};
    const { data, error } = await ctx.supabase.from("business_trip_removed_packets").select("batch_id").in("batch_id", i.batch_ids.slice(0, 300));
    if (error) throw new Error(error.message);
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as any[]) if (r.batch_id) out[r.batch_id] = (out[r.batch_id] ?? 0) + 1;
    return out;
  });

/** Today's left-behind stats for a business (IST), plus share of today's packets. */
export const getLeftBehindToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { merchant_id: string }) => i)
  .handler(async ({ data: i, context }) => {
    const ctx = context as Ctx;
    await requireOpsStaff(ctx);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const { data: s, error } = await ctx.supabase.rpc("business_left_behind_stats", { _merchant_id: i.merchant_id, _date: today });
    if (error) throw new Error(error.message);
    const total = Number(s?.total ?? 0);
    const start = new Date(`${today}T00:00:00+05:30`).toISOString();
    const { data: bs } = await ctx.supabase.from("business_batches").select("courier_order_id").eq("merchant_id", i.merchant_id).gte("created_at", start).not("courier_order_id", "is", null);
    const ids = ((bs ?? []) as any[]).map((b) => b.courier_order_id);
    let onTrips = 0;
    if (ids.length) {
      const { count } = await ctx.supabase.from("business_trip_packets").select("id", { count: "exact", head: true }).in("courier_order_id", ids);
      onTrips = count ?? 0;
    }
    const packetsToday = onTrips + total;
    const toMap = (o: unknown) => Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => ({ key: k, count: Number(v) }));
    return {
      total, packetsToday, high: packetsToday > 0 && total / packetsToday > 0.1,
      byReason: toMap(s?.by_reason), byActor: toMap(s?.by_actor),
    };
  });
