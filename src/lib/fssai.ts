/** Browser-safe FSSAI licence status helpers (dates are YYYY-MM-DD, compared in IST). */
export type FssaiState = { kind: "ok" | "expiring" | "expired" | "missing"; days: number | null; problems: string[] };

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function fssaiState(m: { fssai_number?: string | null; fssai_expiry?: string | null; has_fssai_doc?: boolean }): FssaiState {
  const problems: string[] = [];
  if (!m.fssai_number?.trim()) problems.push("FSSAI number missing");
  if (!m.fssai_expiry) problems.push("FSSAI expiry date missing");
  if (m.has_fssai_doc === false) problems.push("FSSAI file missing");
  let days: number | null = null;
  if (m.fssai_expiry) {
    days = Math.round((Date.parse(m.fssai_expiry.slice(0, 10)) - Date.parse(todayIst())) / 86_400_000);
    if (days < 0) problems.push("FSSAI licence expired");
  }
  const kind = days != null && days < 0 ? "expired" : problems.length ? "missing" : days != null && days <= 30 ? "expiring" : "ok";
  return { kind, days, problems };
}

export const isFssaiDoc = (t: string) => /^fssai/i.test(t);
