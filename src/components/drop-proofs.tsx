import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X } from "lucide-react";
import {
  getFirstTimeToday,
  getProofGlobals,
  getProofSettings,
  getStopProofs,
  resetReceiverLocation,
  saveProofGlobals,
  saveProofSettings,
  type ProofPhoto,
} from "@/lib/bulk-courier.functions";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

const inputCls = "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground";
const btnGhost = "rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-40";
const btn = "rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-40";
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
const time = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const via = (v: string | null) => (v === "otp" ? "OTP" : v ? "Photo" : "—");
const firstTag = <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">Location first time</span>;

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* --------------------------- business settings --------------------------- */

export function ProofSettingsCard({ merchantId, canEdit }: { merchantId: string; canEdit: boolean }) {
  const fn = useServerFn(getProofSettings);
  const save = useServerFn(saveProofSettings);
  const qc = useQueryClient();
  const key = ["bulk", "proof-settings", merchantId];
  const { data } = useQuery({ queryKey: key, queryFn: () => fn({ data: { merchant_id: merchantId } }) });
  const [mode, setMode] = useState("otp");
  const [ret, setRet] = useState(180);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setMode(data.mode); setRet(data.retention); } }, [data]);
  const dirty = !!data && (mode !== data.mode || ret !== data.retention);
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <h4 className="mb-2 text-[13px] font-bold text-foreground">Delivery proof</h4>
      {!data ? <p className="text-[12px] text-muted-foreground">Loading…</p> : !data.hasProfile ? <p className="text-[12px] text-muted-foreground">Business profile not set up yet.</p> : (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[12px] text-muted-foreground">Delivery proof
              <select className={inputCls} disabled={!canEdit} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="otp">OTP</option><option value="bill_photo">Bill Photo</option><option value="otp_or_photo">OTP or Bill Photo</option>
              </select>
            </label>
            <label className="text-[12px] text-muted-foreground">Keep photos for
              <select className={inputCls} disabled={!canEdit} value={ret} onChange={(e) => setRet(Number(e.target.value))}>
                {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
                {![30, 90, 180, 365].includes(ret) ? <option value={ret}>{ret} days</option> : null}
              </select>
            </label>
          </div>
          {canEdit && dirty ? (
            <div className="flex gap-2">
              <input className={inputCls} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className={btn} disabled={busy} onClick={async () => {
                setBusy(true);
                try { await save({ data: { merchant_id: merchantId, mode, retention: ret, reason } }); toast.success("Proof settings saved"); setReason(""); qc.invalidateQueries({ queryKey: key }); } catch (e) { err(e); } finally { setBusy(false); }
              }}>Save</button>
            </div>
          ) : null}
          <p className="text-[11px] text-muted-foreground">{data.last ? `Last changed by ${data.last.by} · ${time(data.last.at)}` : "Not changed yet (defaults)."}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- global settings ---------------------------- */

export function ProofGlobalsCard({ canEdit }: { canEdit: boolean }) {
  const fn = useServerFn(getProofGlobals);
  const save = useServerFn(saveProofGlobals);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["bulk", "proof-globals"], queryFn: () => fn() });
  const [g, setG] = useState("150");
  const [f, setF] = useState("1000");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setG(String(data.geofence)); setF(String(data.firstRadius)); } }, [data]);
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <h4 className="mb-2 text-[13px] font-bold text-foreground">Drop proof — all businesses</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[12px] text-muted-foreground">Proof geofence (m)<input type="number" className={inputCls} disabled={!canEdit} value={g} onChange={(e) => setG(e.target.value)} /></label>
        <label className="text-[12px] text-muted-foreground">First delivery radius from pin (m)<input type="number" className={inputCls} disabled={!canEdit} value={f} onChange={(e) => setF(e.target.value)} /></label>
      </div>
      {canEdit ? <button className={`${btnGhost} mt-2`} disabled={busy || !data} onClick={async () => {
        setBusy(true);
        try { await save({ data: { geofence: Number(g), firstRadius: Number(f) } }); toast.success("Saved"); qc.invalidateQueries({ queryKey: ["bulk", "proof-globals"] }); } catch (e) { err(e); } finally { setBusy(false); }
      }}>Save</button> : null}
    </div>
  );
}

/* ------------------------------ stop proofs ------------------------------ */

function Lightbox({ photo, onClose }: { photo: ProofPhoto; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-foreground/90 p-4" onClick={onClose}>
      <button className="absolute right-4 top-4 rounded-full bg-background p-2" onClick={onClose}><X size={16} /></button>
      {photo.url ? <img src={photo.url} alt="Delivery proof" className="max-h-[85vh] max-w-full object-contain" /> : null}
      <p className="mt-2 text-[12px] text-background">{time(photo.captured_at ?? photo.created_at)}{photo.distance_from_pin_m != null ? ` · ${Math.round(photo.distance_from_pin_m)} m from pin` : ""}</p>
    </div>
  );
}

export function StopProofs({ stopId }: { stopId: string }) {
  const fn = useServerFn(getStopProofs);
  const { data, error } = useQuery({ queryKey: ["bulk", "stop-proofs", stopId], queryFn: () => fn({ data: { stop_id: stopId } }), staleTime: 5 * 60e3 });
  const [open, setOpen] = useState<ProofPhoto | null>(null);
  if (error) return <p className="mt-1 text-[11px] text-destructive">{(error as Error).message}</p>;
  if (!data) return <p className="mt-1 text-[11px] text-muted-foreground">Loading proof…</p>;
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground">Completed via {via(data.completed_via)}</span>
        {data.photos.some((p) => p.first_time) ? firstTag : null}
      </div>
      {data.photos.length ? (
        <div className="flex flex-wrap gap-2">
          {data.photos.map((p) => (
            <button key={p.id} className="w-[120px] text-left" onClick={() => p.url && setOpen(p)}>
              {p.url ? <img src={p.url} alt="Proof" className="h-[90px] w-[120px] rounded-[8px] border border-border object-cover" /> : <div className="flex h-[90px] w-[120px] items-center justify-center rounded-[8px] border border-border text-[11px] text-muted-foreground">Photo expired</div>}
              <p className="text-[10px] text-muted-foreground">{time(p.captured_at ?? p.created_at)}</p>
              <p className="text-[10px] text-muted-foreground">{p.distance_from_pin_m != null ? `${Math.round(p.distance_from_pin_m)} m from pin` : "Distance —"}{p.accuracy_m != null ? ` · ±${Math.round(p.accuracy_m)} m` : ""}</p>
              {p.first_time ? firstTag : null}
            </button>
          ))}
        </div>
      ) : null}
      {open ? <Lightbox photo={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/* ---------------------------- receiver detail ---------------------------- */

function TwoPointMap({ pin, verified }: { pin: { lat: number; lng: number } | null; verified: { lat: number; lng: number } | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false;
    loadGoogleMaps().then(() => {
      if (dead || !ref.current) return;
      const g = window.google.maps;
      const map = new g.Map(ref.current, { center: pin ?? verified, zoom: 16, clickableIcons: false, disableDefaultUI: true, zoomControl: true });
      const b = new g.LatLngBounds();
      if (pin) { new g.Marker({ map, position: pin, label: "P", title: "Saved pin" }); b.extend(pin); }
      if (verified) { new g.Marker({ map, position: verified, label: "V", title: "Verified location" }); b.extend(verified); }
      if (pin && verified) map.fitBounds(b, 40);
    }).catch(() => undefined);
    return () => { dead = true; };
  }, [pin?.lat, pin?.lng, verified?.lat, verified?.lng]);
  return <div ref={ref} className="h-[200px] w-full rounded-[10px] border border-border" />;
}

export function ReceiverLocationPanel({ receiver, canReset, onClose, onChanged }: { receiver: Record<string, any>; canReset: boolean; onClose: () => void; onChanged: () => void }) {
  const reset = useServerFn(resetReceiverLocation);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const pin = receiver.lat != null && receiver.lng != null ? { lat: Number(receiver.lat), lng: Number(receiver.lng) } : null;
  const ver = receiver.verified_lat != null && receiver.verified_lng != null ? { lat: Number(receiver.verified_lat), lng: Number(receiver.verified_lng) } : null;
  return (
    <div className="space-y-2 rounded-[12px] border border-border bg-card p-3">
      <div className="flex items-center justify-between"><h4 className="text-[13px] font-bold text-foreground">{receiver.name}</h4><button onClick={onClose}><X size={14} /></button></div>
      {pin || ver ? <TwoPointMap pin={pin} verified={ver} /> : <p className="text-[12px] text-muted-foreground">No pin or verified location.</p>}
      <p className="text-[12px] text-muted-foreground">P = saved pin · V = verified location{pin && ver ? ` · ${Math.round(haversine(pin, ver))} m apart` : ""}</p>
      <p className="text-[12px] text-foreground">{receiver.verified_at ? `Verified on ${time(receiver.verified_at)}` : "Not verified yet"}</p>
      {canReset && receiver.verified_at ? (
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Reason for reset (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className={btnGhost} disabled={busy || !reason.trim()} onClick={async () => {
            if (!window.confirm("Reset this receiver's verified location? The next delivery will set it again.")) return;
            setBusy(true);
            try { await reset({ data: { receiver_id: receiver.id, reason } }); toast.success("Location reset"); setReason(""); onChanged(); } catch (e) { err(e); } finally { setBusy(false); }
          }}>Reset location</button>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- first-time today ---------------------------- */

export function FirstTimeTodayCard({ merchantId }: { merchantId: string }) {
  const fn = useServerFn(getFirstTimeToday);
  const { data, error } = useQuery({ queryKey: ["bulk", "first-time-today", merchantId], queryFn: () => fn({ data: { merchant_id: merchantId } }) });
  const [open, setOpen] = useState(false);
  const [stop, setStop] = useState<string | null>(null);
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <button className="text-[13px] font-bold text-foreground underline-offset-2 hover:underline disabled:no-underline" disabled={!data?.count} onClick={() => setOpen(!open)}>
        First-time locations today: {data?.count ?? "…"}
      </button>
      {error ? <p className="text-[12px] text-destructive">{(error as Error).message}</p> : null}
      {open && data ? (
        <div className="mt-2 space-y-2">
          {data.rows.map((r) => (
            <div key={r.stop_id} className="rounded-[10px] border border-border p-2 text-[12px]">
              <button className="flex w-full flex-wrap gap-x-3 text-left" onClick={() => setStop(stop === r.stop_id ? null : r.stop_id)}>
                <span>{time(r.completed_at)}</span><b>{r.receiver_name ?? "—"}</b><span>Rider: {r.rider_name ?? "—"}</span>
                <span>{r.seal_codes.join(", ") || "—"}</span><span>via {via(r.completed_via)}</span>
                {r.distance_from_pin_m != null ? <span>{Math.round(r.distance_from_pin_m)} m</span> : null}
              </button>
              {stop === r.stop_id ? <StopProofs stopId={r.stop_id} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
