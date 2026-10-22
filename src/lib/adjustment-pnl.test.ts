import { describe, expect, it } from "vitest";
import { summariseLedgerPnl } from "./adjustment-pnl";

const row = (type: string, amount: number, pnl_tag: string | null = null, reason = "x", pnl_expense_category: string | null = null) =>
  ({ type, amount, pnl_tag, reason, pnl_expense_category });

describe("manual adjustment P&L categories", () => {
  it("bonus debit (referral bonus taken back) reduces bonuses", () => {
    const r = summariseLedgerPnl([row("credit", 4000, null, "Referral bonus"), row("debit", 1000, "bonus")]);
    expect(r.bonuses).toBe(3000);
  });
  it("expense recovery debit offsets that expense category", () => {
    const r = summariseLedgerPnl([row("debit", 258, "expense_recovery", "travel", "Travel")]);
    expect(r.recoveries).toEqual([{ category: "Travel", amount: 258 }]);
    expect(r.recoveryTotal).toBe(258);
  });
  it("payout correction debit reduces expert payouts", () => {
    expect(summariseLedgerPnl([row("debit", 200, "payout_adjustment")]).payoutAdjust).toBe(-200);
  });
  it("advance and untagged debits do not affect P&L", () => {
    const r = summariseLedgerPnl([row("debit", 500, "advance"), row("debit", 300, null, "bonus clawback")]);
    expect(r).toEqual({ bonuses: 0, payoutAdjust: 0, recoveries: [], recoveryTotal: 0 });
  });
});
