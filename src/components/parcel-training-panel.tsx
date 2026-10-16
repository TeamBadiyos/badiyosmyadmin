import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import {
  advanceParcelTrainingOrder,
  clearParcelTrainingOrders,
  createParcelTrainingOrder,
  getParcelTrainingData,
} from "@/lib/parcel-training.functions";

const inputCls = "w-full h-10 px-3 rounded-[10px] border border-border bg-card text-[13px] text-foreground";
const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";
const NEXT: Record<string, string> = {
  REQUESTED: "DRIVER_ASSIGNED", DRIVER_ASSIGNED: "ARRIVED_PICKUP", ARRIVED_PICKUP: "PICKED_UP",
  PICKED_UP: "IN_TRANSIT", IN_TRANSIT: "DELIVERED",
};
const LABEL: Record<string, string> = {
  DRIVER_ASSIGNED: "Assign rider", ARRIVED_PICKUP: "Arrived at pickup", PICKED_UP: "Picked up",
  IN_TRANSIT: "On the way", DELIVERED: "Delivered",
};
const STATUS: Record<string, string> = {
  REQUESTED: "New", DRIVER_ASSIGNED: "Rider assigned", ARRIVED_PICKUP: "At pickup", PICKED_UP: "Picked up",
  IN_TRANSIT: "On the way", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

export function ParcelTrainingPanel() {
  const qc = useQueryClient();
  const fetchData = useServerFn(getParcelTrainingData);
  const q = useQuery({ queryKey: ["parcel-training"], queryFn: () => fetchData(), refetchInterval: 20_000 });
  const advance = useServerFn(advanceParcelTrainingOrder);
  const clear = useServerFn(clearParcelTrainingOrders);
  const [open, setOpen] = useState(false);
  const inv = () => qc.invalidateQueries({ queryKey: ["parcel-training"] });
  const advM = useMutation({
    mutationFn: (v: { id: string; to: string }) => advance({ data: v }),
    onSuccess: () => { toast.success("Status updated"); inv(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const clearM = useMutation({
    mutationFn: () => clear(),
    onSuccess: (r) => { toast.success(`${r.count} training parcels closed`); inv(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const canManage = q.data?.canManage;

  return (
    <section className="bg-card border border-border rounded-[18px] p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-foreground">Parcel Training Orders</h3>
          <p className="text-[12px] text-muted-foreground mt-1">
            Dummy parcel deliveries to practise the pickup → drop steps. They are never sent to live riders and never touch billing, invoices, payouts or reports.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { if (window.confirm("Close all open training parcels?")) clearM.mutate(); }}
              className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-bold">Clear training orders</button>
            <button onClick={() => setOpen(true)} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-1">
              <Plus size={14} /> Dummy parcel
            </button>
          </div>
        )}
      </div>

      {q.isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {q.isError && <p className="text-[13px] text-destructive">Could not load training parcels.</p>}
      {q.data && q.data.orders.length === 0 && <p className="text-[13px] text-muted-foreground">No training parcels yet.</p>}

      <div className="space-y-2">
        {q.data?.orders.map((o) => {
          const next = NEXT[o.status];
          return (
            <div key={o.id} className="border border-border rounded-[14px] p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-foreground">#{o.orderNumber ?? o.id.slice(0, 8)}</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-accent text-accent-foreground">TRAINING</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-muted text-muted-foreground">{STATUS[o.status] ?? o.status}</span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1 truncate">{o.pickup} → {o.drop}</p>
                <p className="text-[12px] text-muted-foreground truncate">
                  {o.riderName ? `Rider: ${o.riderName} · ` : ""}₹{o.totalAmount} · {new Date(o.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}
                </p>
              </div>
              {canManage && next && (
                <div className="flex gap-2 flex-wrap shrink-0">
                  <button disabled={advM.isPending} onClick={() => advM.mutate({ id: o.id, to: next })} className="h-9 px-3 rounded-[10px] bg-primary text-primary-foreground text-[12px] font-bold">{LABEL[next]}</button>
                  <button disabled={advM.isPending} onClick={() => advM.mutate({ id: o.id, to: "CANCELLED" })} className="h-9 px-3 rounded-[10px] border border-destructive/50 text-destructive text-[12px] font-bold">Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {open && q.data && <CreateDialog data={q.data} onClose={() => setOpen(false)} onDone={inv} />}
    </section>
  );
}

function CreateDialog({ data, onClose, onDone }: {
  data: { vehicles: { id: string; name: string }[]; types: { id: string; name: string }[]; experts: { id: string; name: string }[] };
  onClose: () => void; onDone: () => void;
}) {
  const create = useServerFn(createParcelTrainingOrder);
  const [vehicleTypeId, setV] = useState(data.vehicles[0]?.id ?? "");
  const [courierTypeId, setT] = useState(data.types[0]?.id ?? "");
  const [pickup, setPickup] = useState("Training pickup, Badiyos office");
  const [drop, setDrop] = useState("Training drop point");
  const [amount, setAmount] = useState(50);
  const [expertId, setExpert] = useState("");
  const m = useMutation({
    mutationFn: () => create({ data: { vehicleTypeId, courierTypeId, pickup, drop, amount, expertId: expertId || null } }),
    onSuccess: () => { toast.success("Training parcel created"); onDone(); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg max-h-[92dvh] rounded-t-[18px] sm:rounded-[18px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h4 className="text-[15px] font-bold text-foreground">New dummy parcel</h4>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Vehicle</label>
              <select className={inputCls} value={vehicleTypeId} onChange={(e) => setV(e.target.value)}>{data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className={labelCls}>Parcel type</label>
              <select className={inputCls} value={courierTypeId} onChange={(e) => setT(e.target.value)}>{data.types.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          </div>
          <div><label className={labelCls}>Pickup address</label><input className={inputCls} value={pickup} onChange={(e) => setPickup(e.target.value)} /></div>
          <div><label className={labelCls}>Drop address</label><input className={inputCls} value={drop} onChange={(e) => setDrop(e.target.value)} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Amount (₹, simulated)</label><input type="number" min={0} className={inputCls} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} /></div>
            <div><label className={labelCls}>Trainee rider (optional)</label>
              <select className={inputCls} value={expertId} onChange={(e) => setExpert(e.target.value)}>
                <option value="">Assign later</option>
                {data.experts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></div>
          </div>
        </div>
        <div className="p-4 border-t border-border flex justify-end" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <button disabled={m.isPending || !vehicleTypeId || !courierTypeId} onClick={() => m.mutate()} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">
            {m.isPending ? "Creating…" : "Create parcel"}
          </button>
        </div>
      </div>
    </div>
  );
}
