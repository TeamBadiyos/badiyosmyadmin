export type PnlTag = "bonus" | "expense_recovery" | "payout_adjustment" | "advance";

export const PNL_TAG_OPTIONS: Array<{ value: PnlTag | ""; label: string; hint: string }> = [
  { value: "", label: "Not in report", hint: "Only changes the wallet balance." },
  { value: "bonus", label: "Bonus / incentive", hint: "Credit adds to Bonuses; debit (e.g. referral bonus taken back) reduces Bonuses." },
  { value: "expense_recovery", label: "Expense recovery", hint: "Debit recovers a company expense (e.g. Travel) and offsets it in the P&L." },
  { value: "payout_adjustment", label: "Payout correction", hint: "Credit adds to Expert payouts; debit (fine/penalty) reduces them." },
  { value: "advance", label: "Advance / loan", hint: "Balance only — not profit or loss." },
];

export const PNL_TAG_LABEL: Record<PnlTag, string> = {
  bonus: "Bonus / incentive",
  expense_recovery: "Expense recovery",
  payout_adjustment: "Payout correction",
  advance: "Advance / loan",
};

export type PnlLedgerRow = { amount: number; type: string; reason: string | null; pnl_tag: string | null; pnl_expense_category: string | null };

export type AdjustmentPnl = { bonuses: number; payoutAdjust: number; recoveries: Array<{ category: string; amount: number }>; recoveryTotal: number };

const BONUS_RE = /bonus|incentive|reward|milestone/i;

/** Signed effect of earnings-wallet entries on the P&L. Untagged credits keep the old reason-based bonus rule. */
export function summariseLedgerPnl(rows: PnlLedgerRow[]): AdjustmentPnl {
  let bonuses = 0, payoutAdjust = 0;
  const rec = new Map<string, number>();
  for (const r of rows) {
    const amt = Number(r.amount ?? 0);
    const sign = r.type === "debit" ? -1 : 1;
    if (r.pnl_tag === "bonus") bonuses += sign * amt;
    else if (r.pnl_tag === "payout_adjustment") payoutAdjust += sign * amt;
    else if (r.pnl_tag === "expense_recovery") {
      const cat = r.pnl_expense_category || "Other";
      rec.set(cat, (rec.get(cat) ?? 0) - sign * amt);
    } else if (!r.pnl_tag && r.type === "credit" && BONUS_RE.test(r.reason ?? "")) bonuses += amt;
  }
  const recoveries = [...rec.entries()].map(([category, amount]) => ({ category, amount })).filter((x) => x.amount !== 0);
  return { bonuses, payoutAdjust, recoveries, recoveryTotal: recoveries.reduce((s, x) => s + x.amount, 0) };
}
