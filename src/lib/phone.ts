/** Standard mobile format everywhere: +91XXXXXXXXXX. Masked/non-phone text is returned unchanged. */
export function formatPhone(p: string | null | undefined): string {
  if (p == null || p === "") return "";
  const s = String(p);
  if (/x/i.test(s)) return s;
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  return s;
}
