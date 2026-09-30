import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  getStoreCommissionSettings,
  saveStoreCommissionSettings,
} from "@/lib/merchants.functions";

export function StoreSettingsPage() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getStoreCommissionSettings);
  const save = useServerFn(saveStoreCommissionSettings);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["store", "commission-settings"],
    queryFn: () => fetchSettings(),
  });

  const [defaultPct, setDefaultPct] = useState("0");
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstPct, setGstPct] = useState("18");

  useEffect(() => {
    if (!data) return;
    setDefaultPct(String(data.defaultPct));
    setGstEnabled(data.gstEnabled);
    setGstPct(String(data.gstPct));
  }, [data]);

  const m = useMutation({
    mutationFn: () =>
      save({ data: { defaultPct: Number(defaultPct), gstEnabled, gstPct: Number(gstPct) } }),
    onSuccess: () => {
      toast.success("Store settings saved");
      qc.invalidateQueries({ queryKey: ["store", "commission-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const canEdit = !!data?.canEdit;
  const d = Number(defaultPct);
  const g = Number(gstPct);
  const valid =
    Number.isFinite(d) && d >= 0 && d <= 50 && Number.isFinite(g) && g >= 0 && g <= 100;

  if (isLoading) {
    return <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>;
  }
  if (isError) {
    return <p className="text-[13px] text-destructive py-10 text-center">Failed to load settings.</p>;
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-card border border-border rounded-[18px] p-6 space-y-5">
        <div>
          <h2 className="text-[16px] font-bold text-foreground">Commission</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Used for new store orders. Each merchant can have its own commission.
          </p>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-muted-foreground">
            Default commission %
          </label>
          <input
            type="number"
            min={0}
            max={50}
            step="0.01"
            disabled={!canEdit}
            value={defaultPct}
            onChange={(e) => setDefaultPct(e.target.value)}
            className="mt-1 w-full h-10 rounded-[12px] border border-border bg-background px-3 text-[14px] disabled:opacity-60"
          />
          <p className="mt-1 text-[12px] text-muted-foreground">Between 0 and 50%.</p>
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={gstEnabled}
            onChange={(e) => setGstEnabled(e.target.checked)}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="text-[14px] font-semibold text-foreground">GST on commission</span>
        </label>

        <div>
          <label className="text-[12px] font-semibold text-muted-foreground">GST %</label>
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            disabled={!canEdit || !gstEnabled}
            value={gstPct}
            onChange={(e) => setGstPct(e.target.value)}
            className="mt-1 w-full h-10 rounded-[12px] border border-border bg-background px-3 text-[14px] disabled:opacity-60"
          />
        </div>

        {canEdit ? (
          <button
            disabled={!valid || m.isPending}
            onClick={() => m.mutate()}
            className="h-10 px-5 rounded-[12px] bg-primary text-white text-[13px] font-bold disabled:opacity-50"
          >
            {m.isPending ? "Saving…" : "Save"}
          </button>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            Only a super admin can change these settings.
          </p>
        )}
      </div>
    </div>
  );
}
