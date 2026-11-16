export const OVERRIDE_REASONS = ["Rider phone dead", "OTP not received", "Customer unreachable", "App issue", "Other"] as const;
export type OverrideAction = "arrive" | "complete" | "fail" | "undo" | "assign" | "unassign" | "complete_all" | "status" | "otp";
export function validateOverrideReason(reason: string, note = "") {
  if (!(OVERRIDE_REASONS as readonly string[]).includes(reason)) throw new Error("Select an override reason");
  if (reason === "Other" && note.trim().length < 10) throw new Error("Other requires a note of at least 10 characters");
  if (note.length > 500) throw new Error("Note is too long");
}
export function overrideNextStates(status: string): string[] {
  const next: Record<string, string[]> = { DRIVER_ASSIGNED: ["ARRIVED_PICKUP"], ARRIVED_PICKUP: ["PICKED_UP"], PICKED_UP: ["IN_TRANSIT"], IN_TRANSIT: ["DELIVERED"] };
  return next[status] ?? [];
}
export function withinUndoWindow(createdAt: string, now = Date.now()) {
  const elapsed = now - new Date(createdAt).getTime();
  return elapsed >= 0 && elapsed <= 30 * 60 * 1000;
}