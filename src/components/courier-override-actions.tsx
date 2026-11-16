import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, Camera, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionBar, ActionBtn } from "@/components/detail-panel";
import { getCourierOrderStops, listCourierRiders, type CourierOrderRow } from "@/lib/courier.functions";
import { applyCourierOverride, getCourierOverrides, uploadCourierOverridePhoto, viewCourierOverridePhoto } from "@/lib/courier-overrides.functions";
import { OVERRIDE_REASONS, overrideNextStates, withinUndoWindow, type OverrideAction } from "@/lib/courier-overrides";

export function CourierOverrideActions({ order, onChanged }: { order: CourierOrderRow; onChanged: () => void }) {
  const qc = useQueryClient();
  const fetchStops = useServerFn(getCourierOrderStops), fetchRiders = useServerFn(listCourierRiders), fetchHistory = useServerFn(getCourierOverrides);
  const apply = useServerFn(applyCourierOverride), upload = useServerFn(uploadCourierOverridePhoto), viewPhoto = useServerFn(viewCourierOverridePhoto);
  const [open, setOpen] = useState(false), [action, setAction] = useState<OverrideAction>("complete"), [stopId, setStopId] = useState("");
  const [reason, setReason] = useState(""), [note, setNote] = useState(""), [expertId, setExpertId] = useState(""), [nextStatus, setNextStatus] = useState("");
  const [photo, setPhoto] = useState<File | null>(null), [busy, setBusy] = useState(false), [distances, setDistances] = useState<Record<string, string>>({});
  const { data: route } = useQuery({ queryKey: ["courier", "stops", order.id], queryFn: () => fetchStops({ data: { orderId: order.id } }) });
  const { data: riders } = useQuery({ queryKey: ["courier", "override-riders", order.id], queryFn: () => fetchRiders({ data: { orderId: order.id } }), enabled: open && action === "assign" });
  const { data: history } = useQuery({ queryKey: ["courier", "overrides", order.id], queryFn: () => fetchHistory({ data: { orderId: order.id } }) });
  const stops = route?.stops ?? [];
  const selected = stops.find((s) => s.id === stopId);
  const perStop = ["arrive", "complete", "fail", "undo", "otp"].includes(action);
  const closed = ["COMPLETED", "DELIVERED", "CANCELLED", "FAILED_DELIVERY"].includes(order.status);
  const returnPickups = action === "fail" && selected?.stop_type === "drop"
    ? stops.filter((s) => s.stop_type === "pickup" && route?.parcels.some((p) => p.drop_stop_id === stopId && p.pickup_stop_id === s.id && p.status === "picked" && !p.return_stop_id)) : [];
  async function submit() {
    if (!window.confirm(action === "complete_all" ? "Confirm every remaining route stop is finished? Normal rider earnings will be posted." : "Apply this staff override?")) return;
    setBusy(true);
    try {
      let photoPath: string | undefined;
      if (photo) { const f = new FormData(); f.set("orderId", order.id); f.set("photo", photo); photoPath = (await upload({ data: f })).path; }
      await apply({ data: { orderId: order.id, action, reason, note, stopId: perStop ? stopId : undefined, expertId: action === "assign" ? expertId : undefined, nextStatus: action === "status" ? nextStatus : undefined, photoPath,
        returnDistances: returnPickups.length ? Object.fromEntries(returnPickups.map((p) => [p.id, Number(distances[p.id])])) : undefined } });
      toast.success("Staff override recorded"); await qc.invalidateQueries({ queryKey: ["courier"] }); setOpen(false); onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Override failed"); } finally { setBusy(false); }
  }
  const cls = "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground w-full";
  return <div className="mt-3 space-y-3">
    {!closed && <ActionBar normal={<ActionBtn icon={<ShieldCheck size={13} />} onClick={() => setOpen(!open)}>Staff override</ActionBtn>} />}
    {open && <section className="border-t border-border pt-3 space-y-3">
      <div className="flex items-center justify-between"><h4 className="text-sm font-bold">Staff override</h4><Button variant="ghost" size="icon" aria-label="Close override" onClick={() => setOpen(false)}><X /></Button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs space-y-1">Action<select className={cls} value={action} onChange={(e) => { setAction(e.target.value as OverrideAction); setStopId(""); }}>
          <option value="arrive">Mark stop arrived</option><option value="complete">Mark picked up / delivered — no OTP</option><option value="fail">Mark failed / not available</option><option value="undo">Undo last stop status</option><option value="assign">Assign / reassign rider</option><option value="unassign">Unassign rider</option><option value="complete_all">Complete all remaining stops</option><option value="status">Change to next valid state</option><option value="otp">Resend / regenerate stop OTP</option>
        </select></label>
        {perStop && <label className="text-xs space-y-1">Stop<select className={cls} value={stopId} onChange={(e) => setStopId(e.target.value)}><option value="">Select stop</option>{stops.filter((s) => action === "undo" ? history?.some((h) => h.stop_id === s.id && !h.undone_at && withinUndoWindow(h.created_at)) : ["pending", "arrived"].includes(s.status)).map((s) => <option key={s.id} value={s.id}>{s.sequence}. {s.stop_type} · {s.contact_name ?? s.status}</option>)}</select></label>}
        {action === "assign" && <label className="text-xs space-y-1">Rider<select className={cls} value={expertId} onChange={(e) => setExpertId(e.target.value)}><option value="">Select rider</option>{riders?.map((r) => <option key={r.id} value={r.id} disabled={r.status === "offline"}>{r.name} · {r.status}</option>)}</select></label>}
        {action === "status" && <label className="text-xs space-y-1">Next state<select className={cls} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}><option value="">Select next state</option>{overrideNextStates(order.status).map((s) => <option key={s}>{s}</option>)}</select></label>}
        <label className="text-xs space-y-1">Reason<select className={cls} value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Select reason</option>{OVERRIDE_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
      </div>
      <label className="block text-xs space-y-1">Note {reason === "Other" ? "(required)" : "(optional)"}<textarea className={`${cls} h-20 py-2`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      {returnPickups.map((p) => <label key={p.id} className="block text-xs space-y-1">Road distance for return to {p.contact_name ?? `pickup ${p.sequence}`} (km)<input className={cls} type="number" min="0" step="0.1" value={distances[p.id] ?? ""} onChange={(e) => setDistances({ ...distances, [p.id]: e.target.value })} /></label>)}
      <label className="flex flex-wrap items-center gap-2 text-xs"><Camera size={16} /> Optional photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
      <Button disabled={busy || !reason || (reason === "Other" && note.trim().length < 10) || (perStop && !stopId) || (action === "assign" && !expertId) || (action === "status" && !nextStatus) || returnPickups.some((p) => !distances[p.id])} onClick={() => void submit()}><ShieldCheck />{busy ? "Applying…" : "Apply override"}</Button>
    </section>}
    {(history?.length ?? 0) > 0 && <section className="border-t border-border pt-3"><h4 className="text-xs font-bold mb-2">Staff overrides</h4>{history?.map((h) => <div key={h.id} className="py-2 border-b border-border text-xs"><p className="font-semibold">{h.action.replaceAll("_", " ")} · by staff {h.staff_name} (override){h.undone_at ? " · Undone" : ""}</p><p className="text-muted-foreground">{new Date(h.created_at).toLocaleString("en-IN")} · {h.reason}{h.note ? `: ${h.note}` : ""}</p>{h.photo_path && <Button variant="link" size="sm" onClick={async () => { try { const { url } = await viewPhoto({ data: { overrideId: h.id } }); window.open(url, "_blank", "noopener,noreferrer"); } catch { toast.error("Photo not available"); } }}>View photo</Button>}</div>)}</section>}
  </div>;
}