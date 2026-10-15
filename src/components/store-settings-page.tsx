import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import {
  getStoreCommissionSettings,
  saveStoreCommissionSettings,
} from "@/lib/merchants.functions";

/** Read-only commission GST from Platform Settings → Tax Settings (the only source). */
export function CommissionGstReadOnly({ onOpenTax }: { onOpenTax?: () => void }) {
  const q = useQuery({
    queryKey: ["platform", "tax", "commission_gst"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_settings")
        .select("rate_pct, is_active")
        .eq("key", "commission_gst")
        .maybeSingle();
      if (error) throw error;
      return data as { rate_pct: number; is_active: boolean } | null;
    },
  });
  const t = q.data;
  return (
    <div className="rounded-[12px] border border-border bg-muted/40 p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[14px] font-semibold text-foreground">GST on commission</p>
        <p className="text-[12px] text-muted-foreground">
          {q.isLoading ? "Loading…" : t ? (t.is_active ? `${Number(t.rate_pct)}% · On` : `${Number(t.rate_pct)}% · Off`) : "Not set"} — set in Platform Settings → Tax Settings
        </p>
      </div>
      {onOpenTax ? (
        <button onClick={onOpenTax} className="h-9 px-4 rounded-[10px] border border-border bg-card text-[13px] font-semibold">
          Open Tax Settings
        </button>
      ) : null}
    </div>
  );
}

/** Read-only default commission (for Food → Settings). */
export function DefaultCommissionReadOnly({ onOpenStoreSettings }: { onOpenStoreSettings?: () => void }) {
  const fetchSettings = useServerFn(getStoreCommissionSettings);
  const { data, isLoading } = useQuery({ queryKey: ["store", "commission-settings"], queryFn: () => fetchSettings() });
  return (
    <div className="rounded-[18px] border border-border bg-card p-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-[14px] font-semibold text-foreground">Default commission for new restaurants</p>
        <p className="text-[12px] text-muted-foreground">
          {isLoading ? "Loading…" : `${data?.defaultPct ?? 10}%`} — same setting as new stores, edited in Store → Settings
        </p>
      </div>
      {onOpenStoreSettings ? (
        <button onClick={onOpenStoreSettings} className="h-9 px-4 rounded-[10px] border border-border bg-card text-[13px] font-semibold">
          Edit in Store Settings
        </button>
      ) : null}
    </div>
  );
}

export function StoreSettingsPage({ onOpenTax }: { onOpenTax?: () => void }) {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getStoreCommissionSettings);
  const save = useServerFn(saveStoreCommissionSettings);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["store", "commission-settings"],
    queryFn: () => fetchSettings(),
  });

  const [defaultPct, setDefaultPct] = useState("10");
  useEffect(() => {
    if (data) setDefaultPct(String(data.defaultPct));
  }, [data]);

  const m = useMutation({
    mutationFn: () =>
      save({ data: { defaultPct: Number(defaultPct), gstEnabled: !!data?.gstEnabled, gstPct: Number(data?.gstPct ?? 18) } }),
    onSuccess: () => {
      toast.success("Store settings saved");
      qc.invalidateQueries({ queryKey: ["store", "commission-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const canEdit = !!data?.canEdit;
  const d = Number(defaultPct);
  const valid = Number.isFinite(d) && d >= 0 && d <= 50;

  if (isLoading) return <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>;
  if (isError) return <p className="text-[13px] text-destructive py-10 text-center">Failed to load settings.</p>;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-card border border-border rounded-[18px] p-6 space-y-5">
        <div>
          <h2 className="text-[16px] font-bold text-foreground">Commission</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Default for new stores and new restaurants. Each merchant can have its own commission.
          </p>
        </div>
        <div>
          <label className="text-[12px] font-semibold text-muted-foreground">Default commission % (Store & Food)</label>
          <input
            type="number" min={0} max={50} step="0.01" disabled={!canEdit}
            value={defaultPct} onChange={(e) => setDefaultPct(e.target.value)}
            className="mt-1 w-full h-10 rounded-[12px] border border-border bg-background px-3 text-[14px] disabled:opacity-60"
          />
          <p className="mt-1 text-[12px] text-muted-foreground">Between 0 and 50%.</p>
        </div>
        <CommissionGstReadOnly onOpenTax={onOpenTax} />
        {canEdit ? (
          <button
            disabled={!valid || m.isPending} onClick={() => m.mutate()}
            className="h-10 px-5 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50"
          >
            {m.isPending ? "Saving…" : "Save"}
          </button>
        ) : (
          <p className="text-[12px] text-muted-foreground">Only a super admin can change these settings.</p>
        )}
      </div>
    </div>
  );
}
