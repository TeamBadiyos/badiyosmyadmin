import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Cfg = {
  expert_min_version_code: number;
  expert_latest_version: string | null;
  expert_latest_version_code: number | null;
  expert_play_store_url: string;
  min_supported_version_code: number;
  current_version: string;
  latest_version_code: number;
  play_store_url: string | null;
};

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("app_config").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data as Cfg | null;
    },
  });
}

export function useExpertOldApp(minCode?: number) {
  return useQuery({
    queryKey: ["expert-app-version-summary", minCode],
    enabled: minCode != null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("staff_expert_app_version_summary", { _min_code: minCode });
      if (error) throw error;
      return data as { total: number; on_old_app: number; on_new_app: number; min_version_code: number };
    },
  });
}

/** "On old app: N" chip for People → Experts (uses the Expert App minimum, default 6). */
export function OldAppBadge({ active, onClick }: { active?: boolean; onClick?: () => void }) {
  const cfg = useAppConfig();
  const min = cfg.data ? Math.max(cfg.data.expert_min_version_code ?? 6, 6) : undefined;
  const q = useExpertOldApp(min);
  if (!q.data) return null;
  return (
    <button onClick={onClick} title={`Active experts below version code ${min} (or not reported yet)`}
      className={`h-8 px-3 rounded-full text-[12px] font-semibold border ${active ? "bg-warning text-warning-foreground border-warning" : "bg-warning/15 text-foreground border-warning/40"}`}>
      On old app: {q.data.on_old_app}
    </button>
  );
}

const inp = "h-9 w-full rounded-[10px] border border-border bg-background px-3 text-[13px]";
const lbl = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

/** Settings → App versions (super admin edits; others read). */
export function AppVersionsCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const cfg = useAppConfig();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [warn, setWarn] = useState<string[] | null>(null);
  const c = cfg.data;
  const val = (k: keyof Cfg) => f?.[k] ?? (c?.[k] != null ? String(c[k]) : "");
  const set = (k: keyof Cfg, v: string) => setF({ ...(f ?? {}), [k]: v });
  const old = useExpertOldApp(c ? Number(val("expert_min_version_code")) || c.expert_min_version_code : undefined);

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f ?? {})) {
        const num = /version_code$/.test(k);
        if (num && v !== "" && !/^\d+$/.test(v)) throw new Error(`${k.replace(/_/g, " ")} must be a whole number`);
        patch[k] = num ? (v === "" ? null : Number(v)) : v;
      }
      const { error } = await db.rpc("staff_save_app_versions", { _patch: patch });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("App versions saved");
      setF(null); setWarn(null);
      qc.invalidateQueries({ queryKey: ["app-config"] });
      qc.invalidateQueries({ queryKey: ["expert-app-version-summary"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function trySave() {
    const w: string[] = [];
    const eMin = Number(val("expert_min_version_code")), eLive = Number(val("expert_latest_version_code"));
    if (eLive && eMin > eLive) w.push(`Expert App minimum (${eMin}) is higher than the version live on Play (${eLive}). Experts won't be able to update yet.`);
    if (!eLive) w.push("Expert App live version code is blank — make sure the minimum is already on Play.");
    const cMin = Number(val("min_supported_version_code")), cLive = Number(val("latest_version_code"));
    if (cLive && cMin > cLive) w.push(`Customer App minimum (${cMin}) is higher than the version live on Play (${cLive}).`);
    if (w.length) setWarn(w); else save.mutate();
  }

  if (cfg.isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!c) return <p className="text-muted-foreground text-sm">No app settings found.</p>;
  const ro = !isSuperAdmin;
  const Field = ({ k, label, type = "text" }: { k: keyof Cfg; label: string; type?: string }) => (
    <label className="space-y-1 block"><span className={lbl}>{label}</span>
      <input className={inp} type={type} disabled={ro} value={val(k)} onChange={(e) => set(k, e.target.value)} /></label>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-foreground">Expert App</div>
          {old.data && <span className="rounded-full bg-warning/15 px-3 py-1 text-[12px] font-semibold text-foreground">Experts on old app: {old.data.on_old_app} of {old.data.total}</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field k="expert_min_version_code" label="Minimum version code" />
          <Field k="expert_latest_version_code" label="Version code live on Play" />
          <Field k="expert_latest_version" label="Latest version name" />
          <Field k="expert_play_store_url" label="Play Store link" />
        </div>
      </div>
      <div className="rounded-[14px] border border-border bg-card p-4 space-y-3">
        <div className="font-bold text-foreground">Customer App</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field k="min_supported_version_code" label="Minimum version code" />
          <Field k="latest_version_code" label="Version code live on Play" />
          <Field k="current_version" label="Latest version name" />
          <Field k="play_store_url" label="Play Store link" />
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">Merchant App has no version gate yet, so there is nothing to set for it here.</p>
      {isSuperAdmin && (
        <div className="flex justify-end gap-2">
          {f && <button className="h-9 px-3 text-[13px] text-muted-foreground" onClick={() => setF(null)}>Cancel</button>}
          <button disabled={!f || save.isPending} onClick={trySave} className="h-9 px-4 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">{save.isPending ? "Saving…" : "Save"}</button>
        </div>
      )}
      {warn && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-[14px] p-5 w-full max-w-sm space-y-3">
            <div className="font-bold text-foreground">Are you sure?</div>
            {warn.map((w) => <p key={w} className="text-[13px] text-foreground">{w}</p>)}
            <div className="flex justify-end gap-2">
              <button className="h-9 px-3 text-[13px] text-muted-foreground" onClick={() => setWarn(null)}>Cancel</button>
              <button className="h-9 px-4 rounded-[10px] bg-destructive text-destructive-foreground text-[13px] font-bold" onClick={() => save.mutate()}>Save anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
