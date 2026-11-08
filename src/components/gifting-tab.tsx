import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Gift, LocateFixed, Plus, Search, X } from "lucide-react";
import { PinMap } from "@/components/customer-address-editor";
import { CampaignDetail } from "@/components/gifting-detail";
import { geocodeAddress, getDefaultGiftPickup, listGiftBusinesses, listGiftCampaigns, saveGiftCampaign, saveGiftPickup, type DropInput, type GiftCampaign } from "@/lib/gifting.functions";

export const btn = "inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-40";
export const ghost = "inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-40";
export const danger = "inline-flex items-center gap-1.5 rounded-[10px] border border-destructive/40 px-3 py-1.5 text-[12px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40";
export const input = "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground";

export function err(e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }

/** CSV columns: name, phone, address, lat, lng, note, packets (header row required) */
export function parseDropsCsv(text: string): DropInput[] {
  const rows: string[][] = [];
  let cur: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { cur.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; cur.push(f); rows.push(cur); cur = []; f = ""; }
    else f += ch;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...n: string[]) => h.findIndex((x) => n.includes(x));
  const ci = { name: col("name", "recipient", "recipient_name"), phone: col("phone", "mobile"), address: col("address"),
    lat: col("lat", "latitude"), lng: col("lng", "lon", "long", "longitude"), note: col("note", "gift", "gift_note"), packets: col("packets", "qty", "packet_count") };
  if (ci.name < 0 || ci.address < 0) throw new Error("CSV needs columns: name, address (phone, lat, lng, note, packets optional)");
  return body.map((r) => ({
    recipient_name: (r[ci.name] ?? "").trim(), recipient_phone: ci.phone >= 0 ? r[ci.phone]?.trim() : undefined,
    address: (r[ci.address] ?? "").trim(),
    lat: ci.lat >= 0 && r[ci.lat]?.trim() ? Number(r[ci.lat]) : (null as unknown as number),
    lng: ci.lng >= 0 && r[ci.lng]?.trim() ? Number(r[ci.lng]) : (null as unknown as number),
    gift_note: ci.note >= 0 ? r[ci.note]?.trim() : undefined, packet_count: ci.packets >= 0 ? Number(r[ci.packets]) || 1 : 1,
  }));
}

export function GiftingTab() {
  const listFn = useServerFn(listGiftCampaigns);
  const { data, isLoading, error } = useQuery({ queryKey: ["gifting", "campaigns"], queryFn: () => listFn() });
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<GiftCampaign> | null>(null);
  const open = data?.find((c) => c.id === openId) ?? null;

  if (open) return <CampaignDetail c={open} onBack={() => setOpenId(null)} onEdit={() => setEditing(open)} editing={editing} setEditing={setEditing} />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-foreground">Bulk gifting campaigns</h2>
          <p className="text-[12px] text-muted-foreground">Many drops from one pickup, grouped zone-wise into trips.</p>
        </div>
        <button className={btn} onClick={() => setEditing({})}><Plus className="h-4 w-4" />New campaign</button>
      </div>
      {isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : error ? <p className="text-[13px] text-destructive">{String((error as Error).message)}</p> : null}
      <div className="overflow-hidden rounded-[12px] border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted text-left text-[11px] uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Business</th><th className="px-3 py-2">Pickup date</th><th className="px-3 py-2">Drops</th><th className="px-3 py-2">Trips</th><th className="px-3 py-2">Status</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-border hover:bg-muted/50" onClick={() => setOpenId(c.id)}>
                <td className="px-3 py-2 font-semibold text-foreground"><Gift className="mr-1.5 inline h-3.5 w-3.5 text-primary" />{c.name}{c.is_test ? <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">TEST</span> : null}</td>
                <td className="px-3 py-2">{c.business_name}</td>
                <td className="px-3 py-2">{c.pickup_date ?? "—"}</td>
                <td className="px-3 py-2">{c.drops}</td>
                <td className="px-3 py-2">{c.trips}</td>
                <td className="px-3 py-2 capitalize">{c.status}</td>
              </tr>
            ))}
            {data && !data.length ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No gifting campaigns yet</td></tr> : null}
          </tbody>
        </table>
      </div>
      {editing ? <CampaignForm init={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setOpenId(id); }} /> : null}
    </div>
  );
}

export function CampaignForm({ init, onClose, onSaved }: { init: Partial<GiftCampaign>; onClose: () => void; onSaved: (id: string) => void }) {
  const bizFn = useServerFn(listGiftBusinesses);
  const save = useServerFn(saveGiftCampaign);
  const qc = useQueryClient();
  const { data: biz } = useQuery({ queryKey: ["gifting", "biz"], queryFn: () => bizFn() });
  const [f, setF] = useState({
    merchant_id: init.merchant_id ?? "", name: init.name ?? "", occasion: init.occasion ?? "",
    pickup_name: init.pickup_name ?? "", pickup_address: init.pickup_address ?? "",
    pickup_date: init.pickup_date ?? "", max_drops_per_trip: String(init.max_drops_per_trip ?? 12),
  });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(init.pickup_lat != null ? { lat: init.pickup_lat, lng: init.pickup_lng! } : null);
  const [asDefault, setAsDefault] = useState(true);
  const [pk, setPk] = useState(0);
  const defFn = useServerFn(getDefaultGiftPickup);
  const savePickup = useServerFn(saveGiftPickup);
  useEffect(() => {
    if (!f.merchant_id || (init.id && init.pickup_lat != null)) return;
    defFn({ data: { merchant_id: f.merchant_id } }).then((d) => {
      if (!d) return;
      setF((o) => ({ ...o, pickup_name: o.pickup_name || d.name, pickup_address: d.address }));
      setPin({ lat: Number(d.lat), lng: Number(d.lng) }); setPk((x) => x + 1);
    }).catch(() => {});
  }, [f.merchant_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-[14px] bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-[15px] font-bold text-foreground">{init.id ? "Edit campaign" : "New gifting campaign"}</h3><button onClick={onClose}><X className="h-4 w-4" /></button></div>
        <label className="block text-[12px] font-semibold">Business
          <select className={input} value={f.merchant_id} onChange={set("merchant_id")} disabled={!!init.id}>
            <option value="">Select…</option>
            {(biz ?? []).map((b) => <option key={b.merchant_id} value={b.merchant_id}>{b.business_name}{b.city ? ` · ${b.city}` : ""}</option>)}
          </select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[12px] font-semibold">Campaign name<input className={input} value={f.name} onChange={set("name")} /></label>
          <label className="block text-[12px] font-semibold">Occasion<input className={input} value={f.occasion} onChange={set("occasion")} placeholder="Diwali" /></label>
          <label className="block text-[12px] font-semibold">Pickup name<input className={input} value={f.pickup_name} onChange={set("pickup_name")} /></label>
          <label className="block text-[12px] font-semibold">Pickup date<input type="date" className={input} value={f.pickup_date} onChange={set("pickup_date")} /></label>
        </div>
        <label className="block text-[12px] font-semibold">Pickup address<input className={input} value={f.pickup_address} onChange={set("pickup_address")} /></label>
        <PinPicker key={pk} address={f.pickup_address} lat={pin?.lat ?? null} lng={pin?.lng ?? null} onChange={setPin} />
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />Save as business default pickup</label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-[12px] font-semibold">Max drops / trip<input type="number" min={1} className={input} value={f.max_drops_per_trip} onChange={set("max_drops_per_trip")} /></label>
        </div>
        <div className="flex justify-end gap-2">
          <button className={ghost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await save({ data: { id: init.id, merchant_id: f.merchant_id, name: f.name, occasion: f.occasion, pickup_name: f.pickup_name, pickup_address: f.pickup_address,
                pickup_lat: pin?.lat ?? null, pickup_lng: pin?.lng ?? null, pickup_date: f.pickup_date || null, max_drops_per_trip: Number(f.max_drops_per_trip) } });
              if (pin && f.pickup_address.trim()) await savePickup({ data: { campaign_id: r.id, name: f.pickup_name, address: f.pickup_address, lat: pin.lat, lng: pin.lng, as_default: asDefault } });
              await qc.invalidateQueries({ queryKey: ["gifting"] });
              toast.success("Campaign saved"); onSaved(r.id);
            } catch (e) { err(e); } finally { setBusy(false); }
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}


/** Address search + draggable pin + current location. */
export function PinPicker({ address, lat, lng, onChange }: { address: string; lat: number | null; lng: number | null; onChange: (p: { lat: number; lng: number }) => void }) {
  const geo = useServerFn(geocodeAddress);
  const [q, setQ] = useState(address);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address" />
        <button className={ghost} disabled={busy || q.trim().length < 3} onClick={async () => {
          setBusy(true);
          try { const r = await geo({ data: { q } }); if (r) onChange(r); else toast.error("Address not found — drop the pin on the map"); } catch (e) { err(e); } finally { setBusy(false); }
        }}><Search className="h-3.5 w-3.5" />Find</button>
        <button className={ghost} disabled={busy} onClick={() => {
          if (!navigator.geolocation) { toast.error("Location not available in this browser"); return; }
          setBusy(true);
          navigator.geolocation.getCurrentPosition(
            (pos) => { onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setBusy(false); },
            () => { toast.error("Could not get current location"); setBusy(false); },
            { enableHighAccuracy: true, timeout: 15000 },
          );
        }}><LocateFixed className="h-3.5 w-3.5" />Use current location</button>
      </div>
      <PinMap lat={lat} lng={lng} onPick={onChange} />
      <p className="text-[11px] text-muted-foreground">{lat != null ? "Pin set — drag to adjust" : "Click the map or drag the pin"}</p>
    </div>
  );
}
