import { useCity } from "@/lib/city-scope";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";

const TAX_LABELS: Record<string, string> = {
  food_gst_9_5: "Food GST (9(5))",
  order_delivery_gst: "Store/Food delivery GST",
  parcel_delivery_gst: "Parcel delivery GST",
  commission_gst: "Commission GST",
  platform_fee_gst: "Platform fee GST",
  maid_gst: "Clean Home GST",
  wash_gst: "Clean Auto GST",
  store_tcs: "Store TCS",
  tds_194o: "TDS 194-O",
  tds_194o_threshold: "TDS threshold (₹)",
};
const ORDER = Object.keys(TAX_LABELS);
const inp = "h-9 rounded-[10px] border border-border bg-background px-3 text-[13px]";
const btn = "h-9 px-4 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50";
const db = supabase as any;

type Tax = { key: string; label: string; rate_pct: number; is_active: boolean; updated_at: string };

export function TaxSettingsPage({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "tax"],
    queryFn: async () => {
      const { data, error } = await db.from("tax_settings").select("*");
      if (error) throw error;
      return (data as Tax[]).sort((a, b) => (ORDER.indexOf(a.key) + 99) % 199 - (ORDER.indexOf(b.key) + 99) % 199);
    },
  });
  const [edit, setEdit] = useState<{ key: string; rate: string; active: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("staff_update_tax_setting", { _key: edit!.key, _rate: Number(edit!.rate), _active: edit!.active });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved — applies to new orders only"); setEdit(null); setConfirm(false); qc.invalidateQueries({ queryKey: ["platform", "tax"] }); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const cur = data?.find((t) => t.key === edit?.key);
  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  return (
    <div className="rounded-[14px] border border-border bg-card overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="text-left text-muted-foreground border-b border-border">
          <th className="p-3">Tax</th><th className="p-3">Rate</th><th className="p-3">Active</th><th className="p-3"></th>
        </tr></thead>
        <tbody>
          {data?.map((t) => {
            const isEd = edit?.key === t.key;
            const isAmt = t.key === "tds_194o_threshold";
            return (
              <tr key={t.key} className="border-b border-border last:border-0">
                <td className="p-3 font-semibold text-foreground">{TAX_LABELS[t.key] ?? t.label}</td>
                <td className="p-3">{isEd ? <input type="number" step="0.01" min={0} className={inp + " w-28"} value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} /> : isAmt ? `₹${Number(t.rate_pct).toLocaleString("en-IN")}` : `${t.rate_pct}%`}</td>
                <td className="p-3"><Switch disabled={!isSuperAdmin} checked={isEd ? edit.active : t.is_active} onCheckedChange={(v) => { setEdit({ key: t.key, rate: isEd ? edit.rate : String(t.rate_pct), active: v }); setConfirm(true); }} /></td>
                <td className="p-3 text-right">
                  {isSuperAdmin && (isEd ? (
                    <div className="flex gap-2 justify-end">
                      <button className="h-9 px-3 text-[13px] text-muted-foreground" onClick={() => setEdit(null)}>Cancel</button>
                      <button className={btn} onClick={() => setConfirm(true)}>Save</button>
                    </div>
                  ) : (
                    <button className="text-primary font-semibold" onClick={() => setEdit({ key: t.key, rate: String(t.rate_pct), active: t.is_active })}>Edit</button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {confirm && edit && cur && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-[14px] p-5 w-full max-w-sm space-y-3">
            <div className="font-bold text-foreground">{TAX_LABELS[cur.key] ?? cur.label}</div>
            <p className="text-[14px] text-foreground">{cur.rate_pct} → {edit.rate}{cur.key === "tds_194o_threshold" ? "" : "%"}{cur.is_active !== edit.active ? ` · ${edit.active ? "activate" : "deactivate"}` : ""}</p>
            <p className="text-[13px] text-muted-foreground">Applies to new orders only. Old orders keep their saved rate.</p>
            <div className="flex justify-end gap-2">
              <button className="h-9 px-3 text-[13px] text-muted-foreground" onClick={() => setConfirm(false)}>Cancel</button>
              <button className={btn} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Fee = { id?: string; name: string; service_types: string[]; amount_type: "flat" | "percent" | string; amount: number; gst_key: string | null; is_active: boolean; starts_at: string | null; ends_at: string | null; city_id?: string | null };
const SERVICES = ["clean", "store", "food", "parcel"];
const blank: Fee = { name: "", service_types: [], amount_type: "flat", amount: 0, gst_key: "platform_fee_gst", is_active: false, starts_at: null, ends_at: null };

export function ChargesFeesPage({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const { cities, cityId } = useCity();
  const cityName = (id?: string | null) => (id ? cities.find((c) => c.id === id)?.name ?? "—" : "All cities");
  const { data } = useQuery({
    queryKey: ["platform", "fees"],
    queryFn: async () => {
      const { data, error } = await db.from("fee_rules").select("*").order("created_at");
      if (error) throw error;
      return data as Fee[];
    },
  });
  const [form, setForm] = useState<Fee | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "fees"] });
  const save = useMutation({
    mutationFn: async (f: Fee) => {
      const row = { ...f, amount: Number(f.amount), starts_at: f.starts_at || null, ends_at: f.ends_at || null };
      const { error } = f.id ? await db.from("fee_rules").update(row).eq("id", f.id) : await db.from("fee_rules").insert(row);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); setForm(null); refresh(); },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });
  const d = (v: string | null) => (v ? v.slice(0, 10) : "");
  return (
    <div className="space-y-4">
      {isSuperAdmin && <button className={btn} onClick={() => setForm({ ...blank, city_id: cityId === "all" ? null : cityId })}>+ Add fee</button>}
      <div className="rounded-[14px] border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-muted-foreground border-b border-border">
            <th className="p-3">Name</th><th className="p-3">City</th><th className="p-3">Services</th><th className="p-3">Amount</th><th className="p-3">GST</th><th className="p-3">Dates</th><th className="p-3">Active</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {data?.filter((f) => cityId === "all" || !f.city_id || f.city_id === cityId).map((f) => (
              <tr key={f.id} className="border-b border-border last:border-0">
                <td className="p-3 font-semibold text-foreground">{f.name}</td>
                <td className="p-3">{cityName(f.city_id)}</td>
                <td className="p-3">{f.service_types?.join(", ")}</td>
                <td className="p-3">{f.amount_type === "flat" ? `₹${f.amount}` : `${f.amount}%`}</td>
                <td className="p-3">{f.gst_key ? TAX_LABELS[f.gst_key] ?? f.gst_key : "—"}</td>
                <td className="p-3">{d(f.starts_at) || "—"} → {d(f.ends_at) || "—"}</td>
                <td className="p-3"><Switch disabled={!isSuperAdmin || save.isPending} checked={f.is_active} onCheckedChange={(v) => save.mutate({ ...f, is_active: v })} /></td>
                <td className="p-3 text-right">{isSuperAdmin && <button className="text-primary font-semibold" onClick={() => setForm({ ...f })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <div className="fixed inset-0 z-50 bg-foreground/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-[14px] p-5 w-full max-w-md space-y-3 text-[13px]">
            <div className="font-bold text-foreground">{form.id ? "Edit fee" : "Add fee"}</div>
            <input className={inp + " w-full"} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={inp + " w-full"} value={form.city_id ?? ""} onChange={(e) => setForm({ ...form, city_id: e.target.value || null })}>
              <option value="">All cities</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-3 flex-wrap">{SERVICES.map((s) => (
              <label key={s} className="flex items-center gap-1 capitalize"><input type="checkbox" checked={form.service_types.includes(s)} onChange={(e) => setForm({ ...form, service_types: e.target.checked ? [...form.service_types, s] : form.service_types.filter((x) => x !== s) })} />{s}</label>
            ))}</div>
            <div className="flex gap-2">
              <select className={inp} value={form.amount_type} onChange={(e) => setForm({ ...form, amount_type: e.target.value })}><option value="flat">Flat ₹</option><option value="percent">%</option></select>
              <input type="number" min={0} step="0.01" className={inp + " flex-1"} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value as any })} />
            </div>
            <select className={inp + " w-full"} value={form.gst_key ?? ""} onChange={(e) => setForm({ ...form, gst_key: e.target.value || null })}>
              <option value="">No GST</option>{ORDER.filter((k) => !k.startsWith("tds") && k !== "store_tcs").map((k) => <option key={k} value={k}>{TAX_LABELS[k]}</option>)}
            </select>
            <div className="flex gap-2">
              <label className="flex-1">Start<input type="date" className={inp + " w-full"} value={d(form.starts_at)} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
              <label className="flex-1">End<input type="date" className={inp + " w-full"} value={d(form.ends_at)} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
            </div>
            <label className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />Active</label>
            <div className="flex justify-end gap-2">
              <button className="h-9 px-3 text-muted-foreground" onClick={() => setForm(null)}>Cancel</button>
              <button className={btn} disabled={!form.name || save.isPending} onClick={() => save.mutate(form)}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
