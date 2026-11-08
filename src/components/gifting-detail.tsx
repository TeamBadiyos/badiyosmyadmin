import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download, FileText, MapPin, MessageCircle, Plus, Route, Search, Send, Trash2, Truck, Upload, UserCheck, Users, X } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import { btn, danger, err, ghost, input, parseDropsCsv, CampaignForm, PinPicker } from "@/components/gifting-tab";
import {
  addGiftDropsV2, deleteGiftDrop, deleteGiftTestData, addClientFromCustomer, getDefaultGiftPickup, getGiftCampaign, searchBadiyosCustomers, getGiftProofs, listGiftClients, listGiftRiders,
  moveGiftDrop, planGiftTrips, retryGiftDrops, saveGiftPickup, sendAllGiftTrips, sendGiftTrip, setGiftPin, setGiftTripOrder,
  type BadiyosCustomer, type DropInput2, type GiftCampaign, type GiftDrop, type GiftProof, type GiftTrip,
} from "@/lib/gifting.functions";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Not planned", cls: "bg-muted text-muted-foreground" },
  planned: { label: "Planned", cls: "bg-muted text-foreground" },
  sent: { label: "With rider", cls: "bg-accent text-accent-foreground" },
  in_transit: { label: "On the way", cls: "bg-accent text-accent-foreground" },
  delivered: { label: "Delivered", cls: "bg-primary/15 text-primary" },
  failed: { label: "Not delivered", cls: "bg-destructive/15 text-destructive" },
};
const TRIP: Record<string, string> = { planned: "Planned", sent: "Sent to riders", completed: "Completed" };

function Badge({ s }: { s: string }) {
  const m = STATUS[s] ?? { label: s, cls: "bg-muted text-foreground" };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}
const mapsLink = (d: { lat: number | null; lng: number | null; address: string }) =>
  d.lat != null ? `https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`;

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className={`max-h-[92vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} space-y-3 overflow-y-auto rounded-[14px] bg-card p-5`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-[15px] font-bold text-foreground">{title}</h3><button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

function SetPinModal({ d, onClose, onSaved }: { d: GiftDrop; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(setGiftPin);
  const [p, setP] = useState<{ lat: number; lng: number } | null>(d.lat != null ? { lat: d.lat, lng: d.lng! } : null);
  return (
    <Modal title={`Set pin · ${d.recipient_name}`} onClose={onClose}>
      <p className="text-[12px] text-muted-foreground">{d.address}</p>
      <PinPicker address={d.address} lat={p?.lat ?? null} lng={p?.lng ?? null} onChange={setP} />
      <div className="flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button>
        <button className={btn} disabled={!p} onClick={async () => { try { await save({ data: { drop_id: d.id, lat: p!.lat, lng: p!.lng } }); toast.success("Pin saved"); onSaved(); } catch (e) { err(e); } }}>Save pin</button></div>
    </Modal>
  );
}

function PickupModal({ c, onClose, onSaved }: { c: GiftCampaign; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(saveGiftPickup);
  const [f, setF] = useState({ name: c.pickup_name ?? "", address: c.pickup_address ?? "", contact: "" , as_default: true });
  const [p, setP] = useState<{ lat: number; lng: number } | null>(c.pickup_lat != null ? { lat: c.pickup_lat, lng: c.pickup_lng! } : null);
  const defFn = useServerFn(getDefaultGiftPickup);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (c.pickup_lat != null) return;
    defFn({ data: { merchant_id: c.merchant_id } }).then((d) => {
      if (!d) return;
      setF((o) => ({ ...o, name: d.name ?? o.name, address: d.address ?? o.address, contact: d.contact_phone ?? o.contact }));
      setP({ lat: Number(d.lat), lng: Number(d.lng) }); setK((x) => x + 1);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Pickup point" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] font-semibold">Name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block text-[12px] font-semibold">Contact phone<input className={input} value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="+91" /></label>
      </div>
      <label className="block text-[12px] font-semibold">Address<input className={input} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <PinPicker key={k} address={f.address} lat={p?.lat ?? null} lng={p?.lng ?? null} onChange={setP} />
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={f.as_default} onChange={(e) => setF({ ...f, as_default: e.target.checked })} />Save as business default pickup</label>
      <div className="flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button>
        <button className={btn} disabled={!p || !f.address.trim()} onClick={async () => {
          try { await save({ data: { campaign_id: c.id, name: f.name, address: f.address, lat: p!.lat, lng: p!.lng, contact: f.contact, as_default: f.as_default } }); toast.success("Pickup saved"); onSaved(); } catch (e) { err(e); }
        }}>Save pickup</button></div>
    </Modal>
  );
}

function AddRecipientModal({ c, onClose, onSaved, prefill }: { c: GiftCampaign; onClose: () => void; onSaved: () => void; prefill?: { name?: string; phone?: string } }) {
  const add = useServerFn(addGiftDropsV2);
  const [f, setF] = useState({ name: prefill?.name ?? "", phone: prefill?.phone ?? "", address: "", packets: "1", note: "", save: true });
  const [p, setP] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add recipient" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] font-semibold">Name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block text-[12px] font-semibold">Phone<input className={input} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91" /></label>
        <label className="block text-[12px] font-semibold">Packets<input type="number" min={1} className={input} value={f.packets} onChange={(e) => setF({ ...f, packets: e.target.value })} /></label>
        <label className="block text-[12px] font-semibold">Note<input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Diwali hamper" /></label>
      </div>
      <label className="block text-[12px] font-semibold">Address<input className={input} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <PinPicker address={f.address} lat={p?.lat ?? null} lng={p?.lng ?? null} onChange={setP} />
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={f.save} onChange={(e) => setF({ ...f, save: e.target.checked })} />Save as client</label>
      <div className="flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button>
        <button className={btn} disabled={busy || !f.name.trim() || !f.address.trim() || !p} onClick={async () => {
          setBusy(true);
          try {
            await add({ data: { campaign_id: c.id, drops: [{ recipient_name: f.name, recipient_phone: f.phone, address: f.address, lat: p?.lat ?? null, lng: p?.lng ?? null, packet_count: Number(f.packets) || 1, gift_note: f.note, save_client: f.save }] } });
            toast.success("Recipient added"); onSaved();
          } catch (e) { err(e); } finally { setBusy(false); }
        }}>Add</button></div>
    </Modal>
  );
}

function FromClientsModal({ c, onClose, onSaved, onNew }: { c: GiftCampaign; onClose: () => void; onSaved: () => void; onNew: (p: { name?: string; phone?: string }) => void }) {
  const listFn = useServerFn(listGiftClients);
  const add = useServerFn(addGiftDropsV2);
  const findCust = useServerFn(searchBadiyosCustomers);
  const addCust = useServerFn(addClientFromCustomer);
  const [cust, setCust] = useState<BadiyosCustomer[] | null>(null);
  const [cbusy, setCbusy] = useState(false);
  const { data, refetch } = useQuery({ queryKey: ["gifting", "clients", c.merchant_id], queryFn: () => listFn({ data: { merchant_id: c.merchant_id } }) });
  const [q, setQ] = useState("");
  const [onlyAddr, setOnlyAddr] = useState(false);
  const [sel, setSel] = useState<Record<string, string>>({}); // client -> address id
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (data ?? []).filter((x) => (!q || `${x.name} ${x.phone ?? ""} ${x.company ?? ""}`.toLowerCase().includes(q.toLowerCase())) && (!onlyAddr || x.addresses.length > 1)), [data, q, onlyAddr]);
  const allOn = rows.length > 0 && rows.every((r) => sel[r.id]);
  return (
    <Modal title="Add from clients" onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        <input className={input + " max-w-xs"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, company" />
        <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={onlyAddr} onChange={(e) => setOnlyAddr(e.target.checked)} />Only clients with 2+ addresses</label>
        <label className="ml-auto flex items-center gap-1 text-[12px] font-semibold"><input type="checkbox" checked={allOn} onChange={(e) => {
          const n = { ...sel }; for (const r of rows) { if (e.target.checked && r.addresses[0]) n[r.id] = r.addresses[0].id; else delete n[r.id]; } setSel(n);
        }} />Select all ({rows.length})</label>
      </div>
      <div className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-[10px] border border-border">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-[12px]">
            <input type="checkbox" disabled={!r.addresses.length} checked={!!sel[r.id]} onChange={(e) => { const n = { ...sel }; if (e.target.checked) n[r.id] = r.addresses[0]?.id; else delete n[r.id]; setSel(n); }} />
            <div className="w-44 min-w-0"><p className="truncate font-semibold text-foreground">{r.name}</p><p className="text-muted-foreground">{r.phone ? formatPhone(r.phone) : "—"}</p></div>
            {r.addresses.length > 1 ? (
              <select className={input} value={sel[r.id] ?? r.addresses[0].id} onChange={(e) => setSel({ ...sel, [r.id]: e.target.value })}>
                {r.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}{a.is_default ? " (default)" : ""} — {a.address}</option>)}
              </select>
            ) : <p className="flex-1 truncate text-muted-foreground">{r.addresses[0]?.address ?? "No address saved"}</p>}
          </div>
        ))}
        {data && !data.length ? <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">Abhi koi client nahi. Import CSV ya + Add recipient se jodiye.</p> : null}
        {data && data.length > 0 && !rows.length ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            <p>No client found</p>
            <button className={ghost + " mt-2"} onClick={() => { const digits = q.replace(/\D/g, ""); onNew(digits.length >= 6 ? { phone: q.trim() } : { name: q.trim() }); }}><Plus className="h-3.5 w-3.5" />Add as new recipient</button>
          </div>
        ) : null}
      </div>
      <div className="space-y-2 rounded-[10px] border border-border p-3">
        <div className="flex items-center gap-2">
          <p className="text-[12px] font-semibold">Badiyos customer by phone</p>
          <button className={ghost + " ml-auto"} disabled={cbusy || q.replace(/\D/g, "").length < 6} onClick={async () => {
            setCbusy(true); try { setCust(await findCust({ data: { phone: q } })); } catch (e) { err(e); } finally { setCbusy(false); }
          }}><Search className="h-3.5 w-3.5" />Search badiyos customers</button>
        </div>
        {cust && !cust.length ? <p className="text-[12px] text-muted-foreground">No badiyos customer with this phone.</p> : null}
        {(cust ?? []).map((u) => {
          const exists = (data ?? []).some((x) => x.phone && x.phone.replace(/\D/g, "").slice(-10) === u.phone.replace(/\D/g, "").slice(-10));
          return (
            <div key={u.id} className="flex items-center gap-2 text-[12px]">
              <div className="min-w-0 flex-1"><p className="font-semibold text-foreground">{u.name} · {formatPhone(u.phone)}</p><p className="truncate text-muted-foreground">{u.addresses.length ? u.addresses.map((a) => a.label).join(", ") : "No pinned addresses"}</p></div>
              <button className={ghost} disabled={exists || cbusy} onClick={async () => {
                setCbusy(true); try { await addCust({ data: { merchant_id: c.merchant_id, customer: u } }); toast.success("Added as client"); setQ(u.phone.replace(/\D/g, "").slice(-10)); await refetch(); } catch (e) { err(e); } finally { setCbusy(false); }
              }}><Plus className="h-3.5 w-3.5" />{exists ? "Already a client" : "Add as client"}</button>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button>
        <button className={btn} disabled={busy || !Object.keys(sel).length} onClick={async () => {
          setBusy(true);
          try {
            const drops: DropInput2[] = Object.entries(sel).map(([cid, aid]) => {
              const cl = data!.find((x) => x.id === cid)!; const a = cl.addresses.find((x) => x.id === aid) ?? cl.addresses[0];
              return { recipient_name: cl.name, recipient_phone: cl.phone ?? undefined, address: a.address, lat: a.lat, lng: a.lng, client_id: cl.id, address_id: a.id, save_client: false };
            });
            await add({ data: { campaign_id: c.id, drops } }); toast.success(`${drops.length} recipients added`); onSaved();
          } catch (e) { err(e); } finally { setBusy(false); }
        }}>Add {Object.keys(sel).length || ""} selected</button></div>
    </Modal>
  );
}

function AssignModal({ t, onClose, onDone }: { t: GiftTrip; onClose: () => void; onDone: () => void }) {
  const ridersFn = useServerFn(listGiftRiders);
  const send = useServerFn(sendGiftTrip);
  const { data } = useQuery({ queryKey: ["gifting", "riders"], queryFn: () => ridersFn() });
  const [q, setQ] = useState(""); const [id, setId] = useState(""); const [training, setTraining] = useState(false); const [busy, setBusy] = useState(false);
  const list = (data ?? []).filter((r) => (!training || r.mode === "TRAINING") && (!q || r.name?.toLowerCase().includes(q.toLowerCase()))).slice(0, 200);
  return (
    <Modal title={`Assign rider · Trip ${t.trip_no}`} onClose={onClose}>
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={training} onChange={(e) => { setTraining(e.target.checked); setId(""); }} />Training trip (goes only to this trainee, offer to accept)</label>
      <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rider" />
      <select className={input} size={8} value={id} onChange={(e) => setId(e.target.value)}>
        {list.map((r) => <option key={r.id} value={r.id}>{r.name}{r.mode === "TRAINING" ? " · Training" : ""}</option>)}
      </select>
      <div className="flex justify-end gap-2"><button className={ghost} onClick={onClose}>Cancel</button>
        <button className={btn} disabled={busy || !id} onClick={async () => {
          setBusy(true);
          try { const r = await send({ data: { trip_id: t.id, expert_id: id, training } }); toast.success(`Trip ${t.trip_no} sent · ₹${r.total}`); onDone(); } catch (e) { err(e); } finally { setBusy(false); }
        }}>Send to rider</button></div>
    </Modal>
  );
}

function tripText(c: GiftCampaign, t: GiftTrip, list: GiftDrop[]) {
  const lines = [`*${c.name} — Trip ${t.trip_no}* (${t.zone_name ?? ""})`, `Pickup: ${c.pickup_name ?? ""}, ${c.pickup_address ?? ""}`, `${list.length} stops · ${Number(t.distance_km ?? 0).toFixed(1)} km`, ""];
  list.forEach((d, i) => {
    lines.push(`${i + 1}. ${d.recipient_name}${d.recipient_phone ? ` (${formatPhone(d.recipient_phone)})` : ""}`);
    lines.push(`   ${d.address}`); lines.push(`   ${mapsLink(d)}`);
  });
  return lines.join("\n");
}

async function tripsPdf(c: GiftCampaign, trips: { t: GiftTrip; list: GiftDrop[] }[], file: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  trips.forEach(({ t, list }, k) => {
    if (k) doc.addPage();
    let y = 48;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(`${c.name} — Trip ${t.trip_no}`, 40, y); y += 18;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`${c.business_name} · Zone: ${t.zone_name ?? "—"} · ${list.length} stops · ${Number(t.distance_km ?? 0).toFixed(1)} km · ${TRIP[t.status] ?? t.status}`, 40, y); y += 14;
    doc.text(doc.splitTextToSize(`Pickup: ${c.pickup_name ?? ""}, ${c.pickup_address ?? ""}`, W - 80), 40, y); y += 24;
    list.forEach((d, i) => {
      const addr = doc.splitTextToSize(d.address, W - 110);
      const h = 30 + addr.length * 12;
      if (y + h > H - 40) { doc.addPage(); y = 48; }
      doc.setFont("helvetica", "bold"); doc.text(`${i + 1}. ${d.recipient_name}`, 40, y);
      doc.setFont("helvetica", "normal"); doc.text(`${d.recipient_phone ? formatPhone(d.recipient_phone) : ""}   ${STATUS[d.status]?.label ?? d.status}`, W - 40, y, { align: "right" }); y += 13;
      doc.text(addr, 58, y); y += addr.length * 12;
      doc.setTextColor(40, 90, 200); doc.textWithLink("Open in Google Maps", 58, y, { url: mapsLink(d) }); doc.setTextColor(0, 0, 0); y += 18;
    });
  });
  doc.save(file);
}

export function CampaignDetail({ c, onBack, onEdit, editing, setEditing }: { c: GiftCampaign; onBack: () => void; onEdit: () => void; editing: Partial<GiftCampaign> | null; setEditing: (v: Partial<GiftCampaign> | null) => void }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getGiftCampaign);
  const proofsFn = useServerFn(getGiftProofs);
  const planFn = useServerFn(planGiftTrips);
  const moveFn = useServerFn(moveGiftDrop);
  const orderFn = useServerFn(setGiftTripOrder);
  const addFn = useServerFn(addGiftDropsV2);
  const delFn = useServerFn(deleteGiftDrop);
  const delTestFn = useServerFn(deleteGiftTestData);
  const sendFn = useServerFn(sendGiftTrip);
  const sendAllFn = useServerFn(sendAllGiftTrips);
  const retryFn = useServerFn(retryGiftDrops);
  const { data } = useQuery({ queryKey: ["gifting", "campaign", c.id], queryFn: () => getFn({ data: { id: c.id } }), refetchInterval: 30000 });
  const { data: proofs } = useQuery({ queryKey: ["gifting", "proofs", c.id], queryFn: () => proofsFn({ data: { campaign_id: c.id } }), refetchInterval: 60000 });
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "pickup" | "add" | "clients">(null);
  const [prefill, setPrefill] = useState<{ name?: string; phone?: string } | undefined>();
  const [pinFor, setPinFor] = useState<GiftDrop | null>(null);
  const [assign, setAssign] = useState<GiftTrip | null>(null);
  const [retrySel, setRetrySel] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["gifting"] });
  const run = async (f: () => Promise<unknown>, ok?: string) => { setBusy(true); try { await f(); if (ok) toast.success(ok); await refresh(); } catch (e) { err(e); } finally { setBusy(false); } };

  const drops = data?.drops ?? [];
  const trips = data?.trips ?? [];
  const unplanned = drops.filter((d) => !d.trip_id && d.status === "pending");
  const failed = drops.filter((d) => d.status === "failed");
  const testCount = drops.filter((d) => d.is_test).length;
  const proofBy = useMemo(() => { const m = new Map<string, GiftProof[]>(); for (const p of proofs ?? []) { const l = m.get(p.drop_id) ?? []; l.push(p); m.set(p.drop_id, l); } return m; }, [proofs]);
  const tripLists = trips.map((t) => ({ t, list: drops.filter((d) => d.trip_id === t.id).sort((a, b) => (a.stop_seq ?? 0) - (b.stop_seq ?? 0)) }));
  const count = (s: string[]) => drops.filter((d) => s.includes(d.status)).length;
  const fileBase = c.name.replace(/[^\w]+/g, "-");

  const reorder = (tripId: string, list: GiftDrop[], idx: number, dir: -1 | 1) => {
    const ids = list.map((d) => d.id); const j = idx + dir; if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run(() => orderFn({ data: { trip_id: tripId, drop_ids: ids } }));
  };
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const tripNo = new Map(trips.map((t) => [t.id, t.trip_no]));
    const rows = [["Trip", "Stop", "Name", "Phone", "Address", "Lat", "Lng", "Zone", "Pin", "Status", "Delivered at", "Reason", "Photos"],
      ...drops.map((d) => [d.trip_id ? tripNo.get(d.trip_id) : "", d.stop_seq ?? "", d.recipient_name, d.recipient_phone ? formatPhone(d.recipient_phone) : "", d.address, d.lat ?? "", d.lng ?? "",
        d.zone_name ?? "", d.pin_status, STATUS[d.status]?.label ?? d.status, d.delivered_at ?? "", d.fail_reason ?? "", proofBy.get(d.id)?.length ?? 0])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${fileBase}.csv`; a.click();
  };

  const PinTag = ({ d }: { d: GiftDrop }) => d.pin_status === "ok" ? null :
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${d.pin_status === "missing" ? "bg-destructive/15 text-destructive" : "bg-accent text-accent-foreground"}`}>{d.pin_status === "missing" ? "No pin" : "Pin to confirm"}</span>;
  const canPin = (d: GiftDrop) => ["pending", "planned", "failed"].includes(d.status);
  const Photos = ({ d }: { d: GiftDrop }) => {
    const l = proofBy.get(d.id); if (!l?.length) return null;
    return <div className="flex gap-1">{l.map((p, k) => p.url ? <button key={k} onClick={() => setPhoto(p.url)} title={p.kind === "delivered" ? "Delivery photo" : "Not-delivered photo"}><img src={p.url} alt="Proof" className={`h-8 w-8 rounded object-cover ring-2 ${p.kind === "delivered" ? "ring-primary" : "ring-destructive"}`} /></button> : null)}</div>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <button className="text-[12px] font-semibold text-primary" onClick={onBack}>← All campaigns</button>
          <h2 className="text-[16px] font-bold text-foreground">{c.name}{c.is_test ? <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">TEST</span> : null}</h2>
          <p className="text-[12px] text-muted-foreground">{c.business_name} · {c.pickup_date ?? "no date"} · max {c.max_drops_per_trip}/trip</p>
          <button className="mt-1 inline-flex items-center gap-1 text-[12px] text-foreground hover:underline" onClick={() => setModal("pickup")}>
            <MapPin className="h-3.5 w-3.5 text-primary" />Pickup: {c.pickup_address ? `${c.pickup_name ?? ""}, ${c.pickup_address}` : "Set pickup point"}{c.pickup_point_id ? "" : " (not saved as pickup yet)"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={ghost} onClick={onEdit}>Edit</button>
          <button className={ghost} onClick={() => setModal("add")}><Plus className="h-3.5 w-3.5" />Add recipient</button>
          <button className={ghost} onClick={() => setModal("clients")}><Users className="h-3.5 w-3.5" />Add from clients</button>
          <label className={ghost + " cursor-pointer"}><Upload className="h-3.5 w-3.5" />Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
              try {
                const rows = parseDropsCsv(await file.text()); if (!rows.length) throw new Error("CSV is empty");
                setBusy(true);
                const r = await addFn({ data: { campaign_id: c.id, drops: rows } });
                toast.success(`${r.added} drops added${r.lookedUp ? ` · ${r.lookedUp - r.missing} pins found by address (confirm them)` : ""}${r.missing ? ` · ${r.missing} need a pin` : ""}`);
                await refresh();
              } catch (x) { err(x); } finally { setBusy(false); }
            }} /></label>
          <button className={btn} disabled={busy || !drops.length} onClick={() => run(() => planFn({ data: { campaign_id: c.id } }), "Trips planned zone-wise")}><Route className="h-4 w-4" />{trips.length ? "Re-plan" : "Plan trips"}</button>
          <button className={btn} disabled={busy || !trips.some((t) => t.status === "planned") || testCount > 0} title={testCount ? "TEST drops are never sent to riders" : ""} onClick={() => {
            if (!confirm("Send every planned trip to Bulk Delivery riders? The business wallet is charged per trip.")) return;
            run(async () => { const r = await sendAllFn({ data: { campaign_id: c.id } }); toast.success(`${r.sent} trips sent`); r.errors.forEach((x) => toast.error(`Trip ${x.trip}: ${x.error}`)); });
          }}><Send className="h-4 w-4" />Send all trips</button>
          <button className={ghost} disabled={!drops.length} onClick={exportCsv}><Download className="h-3.5 w-3.5" />CSV</button>
          <button className={ghost} disabled={!trips.length} onClick={() => tripsPdf(c, tripLists, `${fileBase}.pdf`)}><FileText className="h-3.5 w-3.5" />Campaign PDF</button>
          {testCount ? <button className={danger} disabled={busy} onClick={() => {
            if (!confirm(`Delete ${testCount} TEST drops and their test clients?`)) return;
            run(async () => { const r = await delTestFn({ data: { campaign_id: c.id } }); toast.success(`Deleted ${r.drops} test drops`); if (r.campaign_deleted) onBack(); });
          }}><Trash2 className="h-3.5 w-3.5" />Delete test data</button> : null}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">CSV columns: name, address (phone, lat, lng, note, packets optional). Rows without lat/lng are found by address and marked "Pin to confirm". Drag a drop onto another trip to move it; arrows reorder stops.{testCount ? " TEST drops are never sent to riders." : ""}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {([["Drops", drops.length], ["Delivered", count(["delivered"])], ["With rider", count(["sent", "in_transit"])], ["Not sent", count(["pending", "planned"])], ["Not delivered", failed.length], ["No pin", drops.filter((d) => d.pin_status === "missing").length]] as const).map(([k, v]) => (
          <div key={k} className="rounded-[12px] border border-border bg-card p-3"><p className="text-[11px] text-muted-foreground">{k}</p><p className="text-[18px] font-bold text-foreground">{v}</p></div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {tripLists.map(({ t, list }) => {
          const planned = t.status === "planned";
          const done = list.filter((d) => d.status === "delivered").length, bad = list.filter((d) => d.status === "failed").length;
          return (
            <div key={t.id} className={`rounded-[12px] border bg-card p-3 ${dragId && planned ? "border-primary/50" : "border-border"}`}
              onDragOver={(e) => planned && e.preventDefault()}
              onDrop={() => { if (planned && dragId && !list.some((d) => d.id === dragId)) run(() => moveFn({ data: { drop_id: dragId, trip_id: t.id } }), "Drop moved"); setDragId(null); }}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-bold text-foreground">Trip {t.trip_no} · {t.zone_name ?? "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{list.length} stops · {Number(t.distance_km ?? 0).toFixed(1)} km · {TRIP[t.status] ?? t.status}{!planned ? ` · ${done} delivered · ${bad} not delivered · ${list.length - done - bad} pending` : ""}</p>
                  {t.fail_reason ? <p className="text-[11px] text-destructive">Last send: {t.fail_reason}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {planned ? <>
                    <button className={ghost} disabled={busy || list.some((d) => d.is_test)} onClick={() => confirm(`Send Trip ${t.trip_no} to Bulk Delivery riders?`) && run(async () => { const r = await sendFn({ data: { trip_id: t.id } }); toast.success(`Trip ${t.trip_no} sent · ₹${r.total}`); })}><Send className="h-3.5 w-3.5" />Send trip</button>
                    <button className={ghost} disabled={busy || list.some((d) => d.is_test)} onClick={() => setAssign(t)}><UserCheck className="h-3.5 w-3.5" />Assign rider</button>
                  </> : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"><Truck className="h-3.5 w-3.5" />With riders</span>}
                  <a className={ghost} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(tripText(c, t, list))}`}><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>
                  <button className={ghost} onClick={() => tripsPdf(c, [{ t, list }], `${fileBase}-trip-${t.trip_no}.pdf`)}><FileText className="h-3.5 w-3.5" />PDF</button>
                </div>
              </div>
              <ol className="space-y-1">
                {list.map((d, i) => (
                  <li key={d.id} draggable={planned} onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)}
                    className={`flex items-center gap-2 rounded-[8px] border border-border px-2 py-1.5 text-[12px] ${planned ? "cursor-grab" : ""}`}>
                    <span className="w-5 text-center font-bold text-primary">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1 font-semibold text-foreground"><span className="truncate">{d.recipient_name}</span><Badge s={d.status} /><PinTag d={d} /></p>
                      <p className="truncate text-muted-foreground">{d.recipient_phone ? formatPhone(d.recipient_phone) + " · " : ""}{d.address}</p>
                      {d.fail_reason && d.status === "failed" ? <p className="text-destructive">{d.fail_reason}</p> : null}
                    </div>
                    <Photos d={d} />
                    {canPin(d) && planned ? <button className="p-0.5" onClick={() => setPinFor(d)} aria-label="Set pin" title="Set pin"><MapPin className="h-3.5 w-3.5" /></button> : null}
                    {planned ? <>
                      <button className="p-0.5 disabled:opacity-30" disabled={busy || i === 0} onClick={() => reorder(t.id, list, i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button className="p-0.5 disabled:opacity-30" disabled={busy || i === list.length - 1} onClick={() => reorder(t.id, list, i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                    </> : null}
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>

      {failed.length ? (
        <div className="rounded-[12px] border border-destructive/40 bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-bold text-foreground">Retry list ({failed.length})</p>
            <button className={btn} disabled={busy || !Object.values(retrySel).some(Boolean)} onClick={() => run(async () => {
              const r = await retryFn({ data: { campaign_id: c.id, drop_ids: Object.keys(retrySel).filter((k) => retrySel[k]) } }); setRetrySel({}); toast.success(`Retry trip ${r.trip_no} created with ${r.drops} drops`);
            })}>Put selected on a new trip</button>
          </div>
          <ul className="space-y-1">
            {failed.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-[8px] border border-border px-2 py-1.5 text-[12px]">
                <input type="checkbox" checked={!!retrySel[d.id]} onChange={(e) => setRetrySel({ ...retrySel, [d.id]: e.target.checked })} />
                <div className="min-w-0 flex-1"><p className="font-semibold text-foreground">{d.recipient_name}</p><p className="truncate text-muted-foreground">{d.address} · <span className="text-destructive">{d.fail_reason ?? "Not delivered"}</span></p></div>
                <Photos d={d} />
                <button className="p-0.5" onClick={() => setPinFor(d)} aria-label="Set pin"><MapPin className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unplanned.length ? (
        <div className="rounded-[12px] border border-border bg-card p-3">
          <p className="mb-2 text-[13px] font-bold text-foreground">Not in a trip yet ({unplanned.length})</p>
          <ul className="space-y-1">
            {unplanned.map((d) => (
              <li key={d.id} draggable={d.lat != null} onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)} className="flex items-center gap-2 rounded-[8px] border border-border px-2 py-1.5 text-[12px]">
                <div className="min-w-0 flex-1"><p className="flex items-center gap-1 font-semibold text-foreground">{d.recipient_name}<PinTag d={d} /></p><p className="truncate text-muted-foreground">{d.address}</p></div>
                <button className={ghost} onClick={() => setPinFor(d)}><MapPin className="h-3.5 w-3.5" />Set pin</button>
                <button className="p-0.5 text-destructive" disabled={busy} onClick={() => confirm("Remove this drop?") && run(() => delFn({ data: { id: d.id } }), "Drop removed")} aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {modal === "pickup" ? <PickupModal c={c} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} /> : null}
      {modal === "add" ? <AddRecipientModal c={c} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} /> : null}
      {modal === "clients" ? <FromClientsModal c={c} onNew={(p) => { setPrefill(p); setModal("add"); }} onClose={() => setModal(null)} onSaved={() => { setModal(null); refresh(); }} /> : null}
      {pinFor ? <SetPinModal d={pinFor} onClose={() => setPinFor(null)} onSaved={() => { setPinFor(null); refresh(); }} /> : null}
      {assign ? <AssignModal t={assign} onClose={() => setAssign(null)} onDone={() => { setAssign(null); refresh(); }} /> : null}
      {photo ? <Modal title="Proof photo" onClose={() => setPhoto(null)}><img src={photo} alt="Proof" className="w-full rounded-[10px]" /></Modal> : null}
      {editing ? <CampaignForm init={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
    </div>
  );
}
