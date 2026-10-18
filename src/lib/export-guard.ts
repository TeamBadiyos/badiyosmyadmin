import { supabase } from "@/integrations/supabase/client";

let rolePromise: Promise<string | null> | null = null;
let lastRole: string | null = null;

/** Current staff role (cached for the session). */
export function staffRole(): Promise<string | null> {
  if (!rolePromise) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rolePromise = Promise.resolve((supabase.rpc as any)("staff_role")).then(
      (r: { data: string | null }) => { lastRole = r?.data ?? null; return lastRole; },
      () => { rolePromise = null; return null; },
    );
  }
  return rolePromise;
}
/** Synchronous best-effort role (null until loaded). */
export const knownRole = () => lastRole;

/** Customer phones in downloads: raw only for super admin, otherwise 98xxxxx800. */
export function exportPhone(p: string | null | undefined, role: string | null): string {
  if (!p) return "";
  if (role === "super_admin") return p;
  const d = p.replace(/\D/g, "").slice(-10);
  return d.length < 5 ? "xxxxx" : `${d.slice(0, 2)}xxxxx${d.slice(-3)}`;
}

/**
 * Logs every file the Command Center downloads (CSV, PDF, ZIP) to the audit log.
 * Patches anchor clicks once so every existing download button is covered.
 */
export function installExportAudit() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __ccExportAudit?: boolean };
  if (w.__ccExportAudit) return;
  w.__ccExportAudit = true;
  void staffRole();
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download) {
      const name = this.download;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void Promise.resolve((supabase.rpc as any)("staff_log_export", { _name: name, _rows: 0, _has_phone: /phone|demand|redemption|spin|lucky|customer/i.test(name) })).catch(() => {});
    }
    return orig.call(this);
  };
}
