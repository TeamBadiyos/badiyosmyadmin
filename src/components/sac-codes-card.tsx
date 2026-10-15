import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const CODES: [string, string][] = [
  ["maid", "Clean Home (maid)"],
  ["wash", "Clean Auto (wash)"],
  ["store_items", "Store items (HSN)"],
  ["food_9_5", "Food — Sec 9(5)"],
  ["store_delivery", "Store delivery"],
  ["food_delivery", "Food delivery"],
  ["parcel", "Parcel"],
  ["platform_fee", "Platform fee"],
  ["commission", "Commission"],
  ["instant_fee", "Instant settlement fee"],
];

export function SacCodesCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["sac-codes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ops_settings").select("key,value").like("key", "sac\\_%");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.key.replace(/^sac_/, ""), r.value ?? ""])) as Record<string, string>;
    },
  });
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("staff_set_sac_codes" as never, { _codes: form } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("SAC/HSN codes saved — used on new invoices"); qc.invalidateQueries({ queryKey: ["sac-codes"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="text-[14px] font-semibold">SAC / HSN codes</h3>
        <p className="text-[12px] text-muted-foreground">Printed on customer and merchant invoices. Confirm with your CA. Changes apply to new invoices.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CODES.map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted-foreground">{label}</span>
            <input
              className="w-32 rounded-md border border-border bg-background px-2 py-1 text-[13px] font-mono"
              value={form[k] ?? ""}
              disabled={!isSuperAdmin}
              inputMode="numeric"
              maxLength={8}
              placeholder="—"
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, "") }))}
            />
          </label>
        ))}
      </div>
      {isSuperAdmin && (
        <div className="flex justify-end">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save codes</Button>
        </div>
      )}
    </div>
  );
}
