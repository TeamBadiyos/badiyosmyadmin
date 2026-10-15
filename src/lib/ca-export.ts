// Monthly CA export: builds a ZIP of CSVs in the browser from fin_ca_export().
import { supabase } from "@/integrations/supabase/client";

type Row = Record<string, unknown>;

function flatten(r: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Row)) out[k2] = typeof v2 === "object" && v2 !== null ? JSON.stringify(v2) : v2;
    } else out[k] = Array.isArray(v) ? v.join(" ") : v;
  }
  return out;
}

function toCsv(rows: Row[]): string {
  const flat = rows.map(flatten);
  const cols = Array.from(new Set(flat.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  if (!cols.length) return "No rows\n";
  return [cols.join(","), ...flat.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

export async function buildCaExportZip(from: string, to: string): Promise<Blob> {
  const { data, error } = await (supabase as any).rpc("fin_ca_export", { _from: from, _to: to });
  if (error) throw new Error(error.message);
  const d = data as Record<string, unknown>;
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const files: [string, string][] = [
    ["01-sales-register.csv", "sales"], ["02-credit-notes.csv", "credit_notes"], ["03-expenses.csv", "expenses"],
    ["04-merchant-settlements.csv", "settlements"], ["05-payouts.csv", "payouts"], ["06-wallet-ledger.csv", "wallet_ledger"],
  ];
  for (const [name, key] of files) zip.file(name, toCsv((d[key] as Row[]) ?? []));
  const pf = await (supabase as any).rpc("fin_partner_fees", { _from: from, _to: to });
  if (pf.error) throw new Error(pf.error.message);
  const pfd = pf.data as { rows: Row[]; fee_income: number; fee_gst: number; deposits_held: number };
  const tax = { ...((d.tax as Row) ?? {}), franchise_fee_income: pfd.fee_income, franchise_fee_gst: pfd.fee_gst, partner_deposits_held: pfd.deposits_held };
  zip.file("07-tax-summary.csv", "Item,Amount\n" + Object.entries(tax).map(([k, v]) => `"${k}",${Number(v ?? 0).toFixed(2)}`).join("\n") + "\n");
  zip.file("08-partner-fees.csv", toCsv((pfd.rows ?? []).map(({ id: _i, partner_id: _p, ...r }) => r)));
  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type PnlExtras = {
  instant_fee: number; instant_fee_gst: number; expenses_total: number; expense_gst: number;
  expenses_by_category: { category: string; amount: number }[];
};

export async function fetchPnlExtras(from: string, to: string): Promise<PnlExtras> {
  const { data, error } = await (supabase as any).rpc("fin_pnl_extras", { _from: from, _to: to });
  if (error) throw new Error(error.message);
  return data as PnlExtras;
}
