import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Thin wrappers over the existing merchant ledger RPCs (access checked inside via ledger_can_read).
const call = async (db: any, fn: string, args: Record<string, unknown>) => {
  const r = await db.rpc(fn, args);
  if (r.error) throw new Error(r.error.message);
  return r.data as any;
};

export const getMerchantLedgerSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { storeId: string }) => ({ storeId: String(i.storeId) }))
  .handler(({ data, context }) => call(context.supabase, "merchant_settlement_summary", { _store_id: data.storeId }));

export const getMerchantLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { storeId: string; from?: string | null; to?: string | null; types?: string[] | null; limit?: number; offset?: number }) => ({
    storeId: String(i.storeId), from: i.from || null, to: i.to || null,
    types: i.types && i.types.length ? i.types.map(String) : null,
    limit: Math.min(Math.max(Number(i.limit ?? 50), 1), 200), offset: Math.max(Number(i.offset ?? 0), 0),
  }))
  .handler(({ data, context }) => call(context.supabase, "merchant_ledger", {
    _store_id: data.storeId, _from: data.from, _to: data.to, _types: data.types, _limit: data.limit, _offset: data.offset,
  }));

export const getMerchantSettlementsList = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { storeId: string; limit?: number; offset?: number }) => ({ storeId: String(i.storeId), limit: Number(i.limit ?? 20), offset: Number(i.offset ?? 0) }))
  .handler(({ data, context }) => call(context.supabase, "merchant_settlements_list", { _store_id: data.storeId, _limit: data.limit, _offset: data.offset }));

export const getMerchantSettlementStatement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { settlementId: string }) => ({ settlementId: String(i.settlementId) }))
  .handler(({ data, context }) => call(context.supabase, "merchant_settlement_statement", { _settlement_id: data.settlementId }));
