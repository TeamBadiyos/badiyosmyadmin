import { describe, expect, it } from "vitest";
import { overrideNextStates, validateOverrideReason, withinUndoWindow } from "./courier-overrides";
describe("courier override rules", () => {
  it("requires one of the specified reasons", () => { expect(() => validateOverrideReason("")).toThrow(); expect(() => validateOverrideReason("OTP not received")).not.toThrow(); });
  it("requires a note for Other", () => { expect(() => validateOverrideReason("Other", "")).toThrow(); expect(() => validateOverrideReason("Other", "Customer confirmed delivery")).not.toThrow(); });
  it("limits Undo to 30 minutes inclusive", () => { const t = "2026-11-16T07:00:00Z"; expect(withinUndoWindow(t, Date.parse(t) + 1800000)).toBe(true); expect(withinUndoWindow(t, Date.parse(t) + 1800001)).toBe(false); });
  it("does not permit a direct in-transit to completed jump", () => { expect(overrideNextStates("IN_TRANSIT")).toEqual(["DELIVERED"]); expect(overrideNextStates("COMPLETED")).toEqual([]); });
});