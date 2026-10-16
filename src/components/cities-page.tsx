import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const err = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));

type CityRow = {
  id: string; name: string; state: string; state_code: string | null; status: string; is_default: boolean;
  zones: number; live_services: number; merchants: number; experts: number; bookings: number; orders: number;
};
type Tpl = {
  prices: { price_option_id: string; service: string; label: string; customer_price: number | null; expert_payout: number; partner_commission: number }[];
  delivery: { service_key: string; delivery_min_fare: number | null; delivery_per_km: number | null }[];
  vehicle_rates: { id: string; vehicle: string | null; segment: string; base_fare: number; per_km: number; min_fare: number }[];
};
const STATUS: Record<string, string> = { active: "Active", coming_soon: "Coming Soon", inactive: "Inactive" };

export function CitiesPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cities", "list"], queryFn: async () => { const { data, error } = await db.rpc("staff_list_cities"); if (error) throw error; return data as CityRow[]; } });
  const [wizard, setWizard] = useState(false);
  const [access, setAccess] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["cities"] }); qc.invalidateQueries({ queryKey: ["staff", "my-cities"] }); };
  const status = useMutation({
    mutationFn: async (v: { id: string; status: string }) => { const { error } = await db.rpc("staff_set_city_status", { _id: v.id, _status: v.status }); if (error) throw error; },
    onSuccess: () => { toast.success("City status saved"); refresh(); }, onError: (e) => toast.error(err(e)),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.rpc("staff_delete_city", { _id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("City deleted"); refresh(); }, onError: (e) => toast.error(err(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Cities you operate in. New cities start with every service as Coming Soon.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAccess(true)}>Staff city access</Button>
          <Button onClick={() => setWizard(true)}>Add city</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">City</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Zones</th><th className="px-3 py-2">Live services</th><th className="px-3 py-2">Stores</th><th className="px-3 py-2">Experts</th><th className="px-3 py-2">Bookings + orders</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td className="px-3 py-4 text-muted-foreground" colSpan={9}>Loading…</td></tr>}
            {q.error && <tr><td className="px-3 py-4 text-destructive" colSpan={9}>{err(q.error)}</td></tr>}
            {(q.data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2 font-semibold">{c.name}{c.is_default && <span className="ml-2 rounded bg-primary-tint px-1.5 py-0.5 text-[10px] text-primary">Default</span>}</td>
                <td className="px-3 py-2">{c.state}{c.state_code ? ` (${c.state_code})` : ""}</td>
                <td className="px-3 py-2">
                  <select className="h-8 rounded-md border border-input bg-background px-2" value={c.status} onChange={(e) => status.mutate({ id: c.id, status: e.target.value })}>
                    {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">{c.zones}</td><td className="px-3 py-2">{c.live_services}</td><td className="px-3 py-2">{c.merchants}</td><td className="px-3 py-2">{c.experts}</td><td className="px-3 py-2">{c.bookings + c.orders}</td>
                <td className="px-3 py-2 text-right">
                  {!c.is_default && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm(`Delete ${c.name}? Only possible when it has no orders, stores, experts or partners.`)) del.mutate(c.id); }}>Delete</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {wizard && <AddCityWizard cities={q.data ?? []} onClose={() => setWizard(false)} onDone={() => { setWizard(false); refresh(); }} />}
      {access && <StaffAccessDialog cities={q.data ?? []} onClose={() => setAccess(false)} />}
    </div>
  );
}

function AddCityWizard({ cities, onClose, onDone }: { cities: CityRow[]; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [state, setState] = useState("Maharashtra");
  const [code, setCode] = useState("27");
  const [from, setFrom] = useState(cities.find((c) => c.is_default)?.id ?? "");
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const load = useMutation({
    mutationFn: async () => { const { data, error } = await db.rpc("staff_city_template", { _from: from }); if (error) throw error; return data as Tpl; },
    onSuccess: (d) => { setTpl(d); setStep(3); }, onError: (e) => toast.error(err(e)),
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("staff_create_city", { _name: name, _state: state, _state_code: code, _copy_from: from || null, _prices: tpl?.prices ?? [], _delivery: tpl?.delivery ?? [], _vehicle_rates: tpl?.vehicle_rates ?? [] });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${name} added. Draw its zones in Settings → Zones (pick ${name} in the top bar).`); onDone(); }, onError: (e) => toast.error(err(e)),
  });
  const num = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const setP = (i: number, k: "customer_price" | "expert_payout" | "partner_commission", v: string) =>
    setTpl((t) => t && { ...t, prices: t.prices.map((p, j) => (j === i ? { ...p, [k]: v === "" ? null : Number(v) } : p)) });
  const setD = (i: number, k: "delivery_min_fare" | "delivery_per_km", v: string) =>
    setTpl((t) => t && { ...t, delivery: t.delivery.map((p, j) => (j === i ? { ...p, [k]: v === "" ? null : Number(v) } : p)) });
  const setV = (i: number, k: "base_fare" | "per_km" | "min_fare", v: string) =>
    setTpl((t) => t && { ...t, vehicle_rates: t.vehicle_rates.map((p, j) => (j === i ? { ...p, [k]: Number(v) } : p)) });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Add city · step {step} of 4</DialogTitle></DialogHeader>
        {step === 1 && (
          <div className="space-y-3">
            <label className="block text-sm">City name<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nanded" /></label>
            <label className="block text-sm">State<Input value={state} onChange={(e) => setState(e.target.value)} /></label>
            <label className="block text-sm">GST state code<Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="27" /></label>
            <div className="flex justify-end"><Button disabled={!name.trim() || !state.trim()} onClick={() => setStep(2)}>Next</Button></div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <label className="block text-sm">Copy settings from
              <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2" value={from} onChange={(e) => setFrom(e.target.value)}>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">Prices, expert pay, delivery rates, vehicle rates, service hours and alert limits are copied. You can change prices next.</p>
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button disabled={!from || load.isPending} onClick={() => load.mutate()}>Next</Button></div>
          </div>
        )}
        {step === 3 && tpl && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold">Clean prices and pay</h3>
              <p className="mb-2 text-xs text-muted-foreground">Leave the price empty to hide that option in this city.</p>
              <table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th>Option</th><th>Price ₹</th><th>Expert pay ₹</th><th>Partner ₹</th></tr></thead>
                <tbody>{tpl.prices.map((p, i) => (
                  <tr key={p.price_option_id}><td className="py-1 pr-2">{p.service} · {p.label}</td>
                    <td><Input className="h-8" type="number" value={num(p.customer_price)} onChange={(e) => setP(i, "customer_price", e.target.value)} /></td>
                    <td><Input className="h-8" type="number" value={num(p.expert_payout)} onChange={(e) => setP(i, "expert_payout", e.target.value)} /></td>
                    <td><Input className="h-8" type="number" value={num(p.partner_commission)} onChange={(e) => setP(i, "partner_commission", e.target.value)} /></td></tr>))}</tbody></table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Store / Food delivery</h3>
              <table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th>Service</th><th>Minimum ₹</th><th>Per km ₹</th></tr></thead>
                <tbody>{tpl.delivery.map((d, i) => (
                  <tr key={d.service_key}><td className="py-1 pr-2 capitalize">{d.service_key}</td>
                    <td><Input className="h-8" type="number" value={num(d.delivery_min_fare)} onChange={(e) => setD(i, "delivery_min_fare", e.target.value)} /></td>
                    <td><Input className="h-8" type="number" value={num(d.delivery_per_km)} onChange={(e) => setD(i, "delivery_per_km", e.target.value)} /></td></tr>))}</tbody></table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Parcel vehicle rates</h3>
              <table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th>Vehicle</th><th>Base ₹</th><th>Per km ₹</th><th>Minimum ₹</th></tr></thead>
                <tbody>{tpl.vehicle_rates.map((v, i) => (
                  <tr key={v.id}><td className="py-1 pr-2">{v.vehicle ?? "Vehicle"} · {v.segment}</td>
                    <td><Input className="h-8" type="number" value={num(v.base_fare)} onChange={(e) => setV(i, "base_fare", e.target.value)} /></td>
                    <td><Input className="h-8" type="number" value={num(v.per_km)} onChange={(e) => setV(i, "per_km", e.target.value)} /></td>
                    <td><Input className="h-8" type="number" value={num(v.min_fare)} onChange={(e) => setV(i, "min_fare", e.target.value)} /></td></tr>))}</tbody></table>
            </div>
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)}>Next</Button></div>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-3 text-sm">
            <p><b>{name}</b>, {state}. All services will start as <b>Coming Soon</b>.</p>
            <p className="text-muted-foreground">Zones: after saving, pick {name} in the top bar and draw its zones in Settings → Zones.</p>
            <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Create city</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StaffAccessDialog({ cities, onClose }: { cities: CityRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["cities", "access"],
    queryFn: async () => {
      const [{ data: staff, error: e1 }, { data: acc, error: e2 }] = await Promise.all([
        db.from("staff_users").select("id, name, role, status").eq("status", "active").order("name"),
        db.from("staff_city_access").select("staff_user_id, city_id"),
      ]);
      if (e1) throw e1; if (e2) throw e2;
      return { staff: staff as { id: string; name: string; role: string }[], acc: acc as { staff_user_id: string; city_id: string }[] };
    },
  });
  const save = useMutation({
    mutationFn: async (v: { id: string; ids: string[] }) => { const { error } = await db.rpc("staff_set_city_access", { _staff_user_id: v.id, _city_ids: v.ids }); if (error) throw error; },
    onSuccess: () => { toast.success("City access saved"); qc.invalidateQueries({ queryKey: ["cities", "access"] }); }, onError: (e) => toast.error(err(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Staff city access</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">No ticks = all cities (super admin, ops manager, finance) or the cities of their zones (area partners). Nobody can change their own access.</p>
        <table className="w-full text-sm">
          <tbody>
            {(q.data?.staff ?? []).map((s) => {
              const mine = (q.data?.acc ?? []).filter((a) => a.staff_user_id === s.id).map((a) => a.city_id);
              return (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2 pr-2">{s.name}<div className="text-xs text-muted-foreground">{s.role.replace("_", " ")}</div></td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-3">
                      {cities.map((c) => (
                        <label key={c.id} className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={mine.includes(c.id)} onChange={(e) => save.mutate({ id: s.id, ids: e.target.checked ? [...mine, c.id] : mine.filter((x) => x !== c.id) })} />
                          {c.name}
                        </label>
                      ))}
                      {!mine.length && <span className="text-xs text-muted-foreground">All allowed</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
