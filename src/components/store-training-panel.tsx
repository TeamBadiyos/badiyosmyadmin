import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import {
  advanceStoreTrainingOrder,
  clearStoreTrainingOrders,
  createStoreTrainingOrder,
  getStoreTrainingData,
} from "@/lib/store-training.functions";

const inputCls = "w-full h-10 px-3 rounded-[10px] border border-border bg-card text-[13px] text-foreground";
const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";
const STEP_LABEL: Record<string, string> = {
  accepted: "Accept order",
  preparing: "Start preparing",
  ready: "Mark ready",
  completed: "Rider pickup & deliver",
  cancelled: "Cancel",
};
const NEXT: Record<string, string> = { pending: "accepted", accepted: "preparing", preparing: "ready", ready: "completed" };

export function StoreTrainingPanel() {
  const qc = useQueryClient();
  const fetchData = useServerFn(getStoreTrainingData);
  const q = useQuery({ queryKey: ["store-training"], queryFn: () => fetchData(), refetchInterval: 20_000 });
  const advance = useServerFn(advanceStoreTrainingOrder);
  const clear = useServerFn(clearStoreTrainingOrders);
  const [open, setOpen] = useState(false);
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["store-training"] });
    qc.invalidateQueries({ queryKey: ["commerce", "board"] });
  };
  const advM = useMutation({
    mutationFn: (v: { id: string; to: string }) => advance({ data: v }),
    onSuccess: () => { toast.success("Status updated"); inv(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const clearM = useMutation({
    mutationFn: () => clear(),
    onSuccess: (r) => { toast.success(`${r.count} training store orders closed`); inv(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const canManage = q.data?.canManage;

  return (
    <section className="bg-card border border-border rounded-[18px] p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-foreground">Store Training Orders</h3>
          <p className="text-[12px] text-muted-foreground mt-1">
            Dummy store orders to test the Store board, timers and alerts. They never touch billing, reports or merchant wallet.
            View them on the store board with the "Training" switch.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { if (window.confirm("Close all open training store orders?")) clearM.mutate(); }}
              className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-bold"
            >
              Clear training orders
            </button>
            <button onClick={() => setOpen(true)} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-1">
              <Plus size={14} /> Dummy store order
            </button>
          </div>
        )}
      </div>

      {q.isLoading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {q.isError && <p className="text-[13px] text-destructive">Could not load training store orders.</p>}
      {q.data && q.data.orders.length === 0 && <p className="text-[13px] text-muted-foreground">No training store orders yet.</p>}

      <div className="space-y-2">
        {q.data?.orders.map((o) => {
          const next = NEXT[o.status];
          return (
            <div key={o.id} className="border border-border rounded-[14px] p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-bold text-foreground">#{o.orderNumber}</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-accent text-accent-foreground">TRAINING</span>
                  <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-muted text-muted-foreground capitalize">{o.status}</span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1 truncate">
                  {o.storeName} · {o.customerName} · ₹{o.totalAmount} · {new Date(o.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}
                </p>
                <p className="text-[12px] text-muted-foreground truncate">{o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</p>
              </div>
              {canManage && next && (
                <div className="flex gap-2 flex-wrap shrink-0">
                  <button disabled={advM.isPending} onClick={() => advM.mutate({ id: o.id, to: next })} className="h-9 px-3 rounded-[10px] bg-primary text-primary-foreground text-[12px] font-bold">
                    {STEP_LABEL[next]}
                  </button>
                  <button disabled={advM.isPending} onClick={() => advM.mutate({ id: o.id, to: "cancelled" })} className="h-9 px-3 rounded-[10px] border border-destructive/50 text-destructive text-[12px] font-bold">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {open && q.data && <CreateDialog stores={q.data.stores} onClose={() => setOpen(false)} onDone={inv} />}
    </section>
  );
}

function CreateDialog({ stores, onClose, onDone }: { stores: { id: string; name: string; products: { id: string; name: string; price: number; unit: string | null }[] }[]; onClose: () => void; onDone: () => void }) {
  const create = useServerFn(createStoreTrainingOrder);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [name, setName] = useState("Training Customer");
  const [phone, setPhone] = useState("9999999999");
  const [address, setAddress] = useState("Training address, Badiyos office");
  const [mode, setMode] = useState<"online" | "cod">("online");
  const store = stores.find((s) => s.id === storeId);
  const total = useMemo(() => (store?.products ?? []).reduce((s, p) => s + (qty[p.id] ?? 0) * p.price, 0), [store, qty]);
  const m = useMutation({
    mutationFn: () => create({ data: {
      merchantId: storeId,
      items: Object.entries(qty).filter(([, n]) => n > 0).map(([productId, n]) => ({ productId, qty: n })),
      customerName: name, customerPhone: phone, address, paymentMode: mode,
    } }),
    onSuccess: () => { toast.success("Training store order created"); onDone(); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-foreground/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-card w-full sm:max-w-lg max-h-[92dvh] rounded-t-[18px] sm:rounded-[18px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h4 className="text-[15px] font-bold text-foreground">New dummy store order</h4>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3">
          {stores.length === 0 && <p className="text-[13px] text-muted-foreground">No approved store with active items.</p>}
          <div>
            <label className={labelCls}>Store</label>
            <select className={inputCls} value={storeId} onChange={(e) => { setStoreId(e.target.value); setQty({}); }}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Items</label>
            <div className="space-y-1 mt-1">
              {store?.products.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-[13px] truncate">{p.name}{p.unit ? ` · ${p.unit}` : ""} — ₹{p.price}</span>
                  <input type="number" min={0} className="w-20 h-9 px-2 rounded-[10px] border border-border bg-card text-[13px]"
                    value={qty[p.id] ?? 0} onChange={(e) => setQty({ ...qty, [p.id]: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Customer name</label><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className={labelCls}>Phone</label><input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Address</label><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div>
            <label className={labelCls}>Payment (simulated)</label>
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "online" | "cod")}>
              <option value="online">Online – paid</option>
              <option value="cod">Cash on delivery</option>
            </select>
          </div>
        </div>
        <div className="p-4 border-t border-border flex items-center justify-between gap-3" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <span className="text-[14px] font-bold">Total ₹{total}</span>
          <button disabled={m.isPending || total <= 0} onClick={() => m.mutate()} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">
            {m.isPending ? "Creating…" : "Create order"}
          </button>
        </div>
      </div>
    </div>
  );
}
