import { describe, it, expect } from "vitest";
import { indiaToday, validateAdjustmentDate } from "./adjustment-date";

describe("manual adjustment date", () => {
  it("preserves the selected debit or credit accounting date", () => {
    expect(validateAdjustmentDate("2026-10-16")).toBe("2026-10-16");
  });
  it("defaults to today's date in India", () => {
    expect(indiaToday(new Date("2026-10-21T20:00:00Z"))).toBe("2026-10-22");
  });
  it("rejects missing and impossible dates", () => {
    expect(() => validateAdjustmentDate("")).toThrow();
    expect(() => validateAdjustmentDate("2026-02-30")).toThrow();
  });
});