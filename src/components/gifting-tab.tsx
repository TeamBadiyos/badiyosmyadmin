import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Gift, Plus, Route, Trash2, Upload, X } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import {
  addGiftDrops, deleteGiftDrop, deleteGiftTestData, getGiftCampaign, listGiftBusinesses, listGiftCampaigns,
  moveGiftDrop, planGiftTrips, saveGiftCampaign, setGiftTripOrder,
  type DropInput, type GiftCampaign, type GiftDrop,
} from "@/lib/gifting.functions";

const btn = "inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-40";
const ghost = "inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-40";
const danger = "inline-flex items-center gap-1.5 rounded-[10px] border border-destructive/40 px-3 py-1.5 text-[12px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40";
const input = "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground";

function err(e: unknown) { toast.error(e instanceof Error ? e.message : String(e)); }

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
  if (ci.name < 0 || ci.address < 0 || ci.lat < 0 || ci.lng < 0) throw new Error("CSV needs columns: name, address, lat, lng (phone, note, packets optional)");
  return body.map((r) => ({
    recipient_name: (r[ci.name] ?? "").trim(), recipient_phone: ci.phone >= 0 ? r[ci.phone]?.trim() : undefined,
    address: (r[ci.address] ?? "").trim(), lat: Number(r[ci.lat]), lng: Number(r[ci.lng]),
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

function CampaignForm({ init, onClose, onSaved }: { init: Partial<GiftCampaign>; onClose: () => void; onSaved: (id: string) => void }) {
  const bizFn = useServerFn(listGiftBusinesses);
  const save = useServerFn(saveGiftCampaign);
  const qc = useQueryClient();
  const { data: biz } = useQuery({ queryKey: ["gifting", "biz"], queryFn: () => bizFn() });
  const [f, setF] = useState({
    merchant_id: init.merchant_id ?? "", name: init.name ?? "", occasion: init.occasion ?? "",
    pickup_name: init.pickup_name ?? "", pickup_address: init.pickup_address ?? "",
    pickup_lat: init.pickup_lat?.toString() ?? "", pickup_lng: init.pickup_lng?.toString() ?? "",
    pickup_date: init.pickup_date ?? "", max_drops_per_trip: String(init.max_drops_per_trip ?? 12),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg space-y-3 rounded-[14px] bg-card p-5" onClick={(e) => e.stopPropagation()}>
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
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-[12px] font-semibold">Pickup lat<input className={input} value={f.pickup_lat} onChange={set("pickup_lat")} /></label>
          <label className="block text-[12px] font-semibold">Pickup lng<input className={input} value={f.pickup_lng} onChange={set("pickup_lng")} /></label>
          <label className="block text-[12px] font-semibold">Max drops / trip<input type="number" min={1} className={input} value={f.max_drops_per_trip} onChange={set("max_drops_per_trip")} /></label>
        </div>
        <div className="flex justify-end gap-2">
          <button className={ghost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await save({ data: { id: init.id, merchant_id: f.merchant_id, name: f.name, occasion: f.occasion, pickup_name: f.pickup_name, pickup_address: f.pickup_address,
                pickup_lat: f.pickup_lat ? Number(f.pickup_lat) : null, pickup_lng: f.pickup_lng ? Number(f.pickup_lng) : null, pickup_date: f.pickup_date || null, max_drops_per_trip: Number(f.max_drops_per_trip) } });
              await qc.invalidateQueries({ queryKey: ["gifting"] });
              toast.success("Campaign saved"); onSaved(r.id);
            } catch (e) { err(e); } finally { setBusy(false); }
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function CampaignDetail({ c, onBack, onEdit, editing, setEditing }: { c: GiftCampaign; onBack: () => void; onEdit: () => void; editing: Partial<GiftCampaign> | null; setEditing: (v: Partial<GiftCampaign> | null) => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getGiftCampaign);
  const planFn = useServerFn(planGiftTrips);
  const moveFn = useServerFn(moveGiftDrop);
  const orderFn = useServerFn(setGiftTripOrder);
  const addFn = useServerFn(addGiftDrops);
  const delFn = useServerFn(deleteGiftDrop);
  const delTestFn = useServerFn(deleteGiftTestData);
  const { data } = useQuery({ queryKey: ["gifting", "campaign", c.id], queryFn: () => getFn({ data: { id: c.id } }) });
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["gifting"] });
  const run = async (f: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await f(); if (ok) toast.success(ok); await refresh(); } catch (e) { err(e); } finally { setBusy(false); } };

  const drops = data?.drops ?? [];
  const trips = data?.trips ?? [];
  const unplanned = drops.filter((d) => !d.trip_id);
  const testCount = drops.filter((d) => d.is_test).length;

  const reorder = (tripId: string, list: GiftDrop[], idx: number, dir: -1 | 1) => {
    const ids = list.map((d) => d.id); const j = idx + dir; if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run(() => orderFn({ data: { trip_id: tripId, drop_ids: ids } }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button className="text-[12px] font-semibold text-primary" onClick={onBack}>← All campaigns</button>
          <h2 className="text-[16px] font-bold text-foreground">{c.name}{c.is_test ? <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">TEST</span> : null}</h2>
          <p className="text-[12px] text-muted-foreground">{c.business_name} · Pickup: {c.pickup_name ?? "—"}, {c.pickup_address ?? "—"} · {c.pickup_date ?? "no date"} · max {c.max_drops_per_trip}/trip</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={ghost} onClick={onEdit}>Edit</button>
          <label className={ghost + " cursor-pointer"}><Upload className="h-3.5 w-3.5" />Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
              try { const rows = parseDropsCsv(await file.text()); if (!rows.length) throw new Error("CSV is empty");
                await run(() => addFn({ data: { campaign_id: c.id, drops: rows } }), `${rows.length} drops added`); } catch (x) { err(x); }
            }} /></label>
          <button className={btn} disabled={busy || !drops.length} onClick={() => run(() => planFn({ data: { campaign_id: c.id } }), "Trips planned zone-wise")}><Route className="h-4 w-4" />{trips.length ? "Re-plan trips" : "Plan trips"}</button>
          {testCount ? <button className={danger} disabled={busy} onClick={() => {
            if (!confirm(`Delete ${testCount} TEST drops and their test clients?`)) return;
            run(async () => { const r = await delTestFn({ data: { campaign_id: c.id } }); toast.success(`Deleted ${r.drops} test drops`); if (r.campaign_deleted) onBack(); });
          }}><Trash2 className="h-3.5 w-3.5" />Delete test data</button> : null}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">CSV columns: name, phone, address, lat, lng, note, packets. Drag a drop onto another trip to move it; use arrows to reorder stops. {testCount ? "TEST drops are never sent to riders." : ""}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Drops", drops.length], ["Trips", trips.length], ["Unplanned", unplanned.length], ["Total km", trips.reduce((s, t) => s + Number(t.distance_km ?? 0), 0).toFixed(1)]].map(([k, v]) => (
          <div key={k} className="rounded-[12px] border border-border bg-card p-3"><p className="text-[11px] text-muted-foreground">{k}</p><p className="text-[18px] font-bold text-foreground">{v}</p></div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {trips.map((t) => {
          const list = drops.filter((d) => d.trip_id === t.id).sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0));
          return (
            <div key={t.id} className={`rounded-[12px] border bg-card p-3 ${dragId ? "border-primary/50" : "border-border"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId && !list.some((d) => d.id === dragId)) run(() => moveFn({ data: { drop_id: dragId, trip_id: t.id } }), "Drop moved"); setDragId(null); }}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-bold text-foreground">Trip {t.trip_no} · {t.zone_name ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">{list.length} stops · {Number(t.distance_km ?? 0).toFixed(1)} km · {t.status}</p>
              </div>
              <ol className="space-y-1">
                {list.map((d, i) => (
                  <li key={d.id} draggable onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)}
                    className="flex cursor-grab items-center gap-2 rounded-[8px] border border-border px-2 py-1.5 text-[12px]">
                    <span className="w-5 text-center font-bold text-primary">{i + 1}</span>
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold text-foreground">{d.recipient_name}</p><p className="truncate text-muted-foreground">{d.recipient_phone ? formatPhone(d.recipient_phone) + " · " : ""}{d.address}</p></div>
                    <button className="p-0.5 disabled:opacity-30" disabled={busy || i === 0} onClick={() => reorder(t.id, list, i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button className="p-0.5 disabled:opacity-30" disabled={busy || i === list.length - 1} onClick={() => reorder(t.id, list, i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>

      {unplanned.length ? (
        <div className="rounded-[12px] border border-border bg-card p-3">
          <p className="mb-2 text-[13px] font-bold text-foreground">Not in a trip yet ({unplanned.length})</p>
          <ul className="space-y-1">
            {unplanned.map((d) => (
              <li key={d.id} draggable onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)} className="flex items-center gap-2 rounded-[8px] border border-border px-2 py-1.5 text-[12px]">
                <div className="min-w-0 flex-1"><p className="truncate font-semibold text-foreground">{d.recipient_name}</p><p className="truncate text-muted-foreground">{d.address}</p></div>
                <button className="p-0.5 text-destructive" disabled={busy} onClick={() => confirm("Remove this drop?") && run(() => delFn({ data: { id: d.id } }), "Drop removed")} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {editing ? <CampaignForm init={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
    </div>
  );
}
