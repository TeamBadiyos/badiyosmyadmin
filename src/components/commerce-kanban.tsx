import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Bike, Store, User, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  cancelStoreOrderWithRefund,
  listCommercePipeline,
  reassignStoreRider,
  type CommerceAlert,
  type CommerceOrder,
  type CommerceStatus,
} from "@/lib/commerce.functions";

const COLUMNS: Array<{ key: CommerceStatus; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed Today" },
];

const ALERT_LABEL: Record<CommerceAlert, string> = {
  merchant_slow: "Merchant not accepting",
  no_rider: "No rider found",
  pickup_delayed: "Pickup delayed",
};

const STATUS_LABEL: Record<CommerceStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
};

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type AudioHandle = { ctx: AudioContext; osc: OscillatorNode; gain: GainNode; interval: number };

function startBeep(ref: React.MutableRefObject<AudioHandle | null>) {
  if (ref.current) return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 620;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const beep = () => {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.13, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.3);
    };
    beep();
    const interval = window.setInterval(beep, 1800);
    ref.current = { ctx, osc, gain, interval };
  } catch {
    /* audio unsupported */
  }
}

function stopBeep(ref: React.MutableRefObject<AudioHandle | null>) {
  const h = ref.current;
  if (!h) return;
  window.clearInterval(h.interval);
  try {
    h.osc.stop();
  } catch {
    /* noop */
  }
  h.ctx.close().catch(() => {});
  ref.current = null;
}

function RiderLine({ o }: { o: CommerceOrder }) {
  if (o.riderName) {
    return (
      <span className="inline-flex items-center gap-1 text-foreground truncate">
        <Bike size={12} className="text-primary shrink-0" />
        <span className="truncate">{o.riderName}</span>
        {o.riderState === "picked_up" && <span className="text-muted-foreground">· picked</span>}
      </span>
    );
  }
  if (o.riderState === "searching") {
    return (
      <span className="inline-flex items-center gap-1 text-warning font-semibold">
        <Bike size={12} className="shrink-0" /> Finding rider
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Bike size={12} className="shrink-0" /> No rider yet
    </span>
  );
}

function OrderSheet({
  order,
  canManage,
  onClose,
}: {
  order: CommerceOrder;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const reassign = useServerFn(reassignStoreRider);
  const cancel = useServerFn(cancelStoreOrderWithRefund);
  const [mode, setMode] = useState<"none" | "rider" | "cancel">("none");
  const [reason, setReason] = useState("");

  const reassignM = useMutation({
    mutationFn: () => reassign({ data: { orderId: order.id } }),
    onSuccess: () => {
      toast.success("Rider search restarted");
      qc.invalidateQueries({ queryKey: ["commerce", "board"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const cancelM = useMutation({
    mutationFn: () => cancel({ data: { orderId: order.id, reason } }),
    onSuccess: () => {
      toast.success("Order cancelled · refund started");
      qc.invalidateQueries({ queryKey: ["commerce", "board"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const closed = order.status === "completed";
  const canReassign = order.paymentStatus === "paid";
  const now = Date.now();

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md bg-card border-l border-border p-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-mono text-muted-foreground">
              {order.orderNumber || `#${order.id.slice(0, 6)}`}
            </p>
            <h3 className="text-[16px] font-bold text-foreground truncate">{order.merchantName}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        {order.alerts.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {order.alerts.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold px-2 py-1">
                <AlertTriangle size={11} /> {ALERT_LABEL[a]}
              </span>
            ))}
          </div>
        )}

        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px] mb-5">
          <dt className="text-muted-foreground">Customer</dt><dd className="text-foreground">{order.customerName}</dd>
          <dt className="text-muted-foreground">Rider</dt><dd><RiderLine o={order} /></dd>
          <dt className="text-muted-foreground">Status</dt><dd className="text-foreground">{STATUS_LABEL[order.status]}</dd>
          <dt className="text-muted-foreground">Placed</dt><dd className="text-foreground">{ago(order.createdAt, now)}</dd>
          {order.readyAt && (<><dt className="text-muted-foreground">Ready</dt><dd className="text-foreground">{ago(order.readyAt, now)}</dd></>)}
          <dt className="text-muted-foreground">Amount</dt><dd className="text-foreground font-semibold">{inr.format(order.totalAmount)} <span className="text-muted-foreground font-normal">· {order.paymentMode ?? "—"} / {order.paymentStatus ?? "—"}</span></dd>
        </dl>

        {!canManage ? (
          <p className="text-[12px] text-muted-foreground">Only super admin or ops manager can change this order.</p>
        ) : closed ? (
          <p className="text-[12px] text-muted-foreground">Completed orders can't be changed.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setMode(mode === "rider" ? "none" : "rider")}
                disabled={!canReassign}
                title={canReassign ? "" : "Only paid, open orders can be reassigned"}
                className="flex-1 h-10 rounded-[14px] border border-primary text-primary text-[13px] font-bold disabled:opacity-40"
              >
                Reassign rider
              </button>
              <button
                onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}
                className="flex-1 h-10 rounded-[14px] border border-destructive text-destructive text-[13px] font-bold"
              >
                Cancel + refund
              </button>
            </div>

            {mode === "rider" && (
              <div className="rounded-[14px] border border-border p-3 space-y-2">
                <p className="text-[12px] text-foreground">
                  The rider search will restart and the nearest free rider will be offered this job. If the old delivery was cancelled, a new one is created.
                </p>
                <button
                  disabled={reassignM.isPending}
                  onClick={() => reassignM.mutate()}
                  className="w-full h-10 rounded-[14px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50"
                >
                  {reassignM.isPending ? "Searching…" : "Re-search rider"}
                </button>
              </div>
            )}

            {mode === "cancel" && (
              <div className="rounded-[14px] border border-destructive/40 p-3 space-y-2">
                <p className="text-[12px] text-foreground">
                  The order will be cancelled and the full paid amount refunded to the customer. The delivery will also be cancelled.
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (required)"
                  rows={3}
                  className="w-full rounded-[10px] border border-border bg-background p-2 text-[13px]"
                />
                <button
                  disabled={!reason.trim() || cancelM.isPending}
                  onClick={() => cancelM.mutate()}
                  className="w-full h-10 rounded-[14px] bg-destructive text-destructive-foreground text-[13px] font-bold disabled:opacity-50"
                >
                  {cancelM.isPending ? "Cancelling…" : "Confirm cancel + full refund"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommerceKanban({ segmentId }: { segmentId: string | null }) {
  const queryClient = useQueryClient();
  const fetchPipeline = useServerFn(listCommercePipeline);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["commerce", "board", segmentId],
    queryFn: () => fetchPipeline({ data: { segmentId } }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const inv = () => queryClient.invalidateQueries({ queryKey: ["commerce", "board"] });
    const channel = supabase
      .channel("commerce-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "merchant_orders" }, inv)
      .on("postgres_changes", { event: "*", schema: "public", table: "offline_sales" }, inv)
      .on("postgres_changes", { event: "*", schema: "public", table: "courier_orders" }, inv)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const grouped = useMemo(() => {
    const map = new Map<CommerceStatus, CommerceOrder[]>();
    COLUMNS.forEach((c) => map.set(c.key, []));
    for (const o of data?.orders ?? []) map.get(o.status)?.push(o);
    return map;
  }, [data]);

  const pendingCount = (grouped.get("pending") ?? []).length;
  const alertCount = (data?.orders ?? []).filter((o) => o.alerts.length > 0).length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.orders.find((o) => o.id === selectedId) ?? null;

  const audioRef = useRef<AudioHandle | null>(null);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem("commerce-audio-muted") === "1");
    } catch {
      /* noop */
    }
  }, []);
  const toggleMute = () =>
    setMuted((v) => {
      try {
        localStorage.setItem("commerce-audio-muted", v ? "0" : "1");
      } catch {
        /* noop */
      }
      return !v;
    });

  useEffect(() => {
    if (muted || (pendingCount === 0 && alertCount === 0)) {
      stopBeep(audioRef);
      return;
    }
    startBeep(audioRef);
  }, [muted, pendingCount, alertCount]);
  useEffect(() => () => stopBeep(audioRef), []);

  const offline = data?.offlineToday;

  return (
    <section className="bg-card border border-border rounded-[18px] p-4 sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-foreground flex items-center gap-2 flex-wrap">
            Commerce Operations
            {alertCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold px-2 py-0.5">
                <AlertTriangle size={11} /> {alertCount} need attention
              </span>
            )}
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Live store orders with rider status. Click a card for actions.
          </p>
          {isError && (
            <p className="text-[12px] text-destructive mt-1">
              Failed to load board{error instanceof Error && error.message ? `: ${error.message}` : ""}.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleMute}
          className={`shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-full border transition-colors ${
            muted
              ? "border-border text-muted-foreground hover:text-foreground bg-background"
              : "border-primary text-primary bg-primary-tint"
          }`}
          aria-pressed={muted}
          aria-label={muted ? "Unmute order alerts" : "Mute order alerts"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      <div className="mb-4 rounded-[12px] border border-border bg-background px-4 py-2.5 flex items-center gap-2 text-[12px]">
        <Store size={14} className="text-primary shrink-0" />
        <span className="text-muted-foreground">Offline POS today:</span>
        <span className="font-bold text-foreground">{offline ? `${offline.count} sales` : "—"}</span>
        <span className="text-muted-foreground">·</span>
        <span className="font-bold text-foreground">{offline ? inr.format(offline.revenue) : "—"}</span>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(5,minmax(220px,1fr))] overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.key) ?? [];
          return (
            <div key={col.key} className="min-w-0 bg-background border border-border rounded-[14px] flex flex-col">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-[12px] font-bold uppercase tracking-wide text-foreground truncate">{col.label}</span>
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-primary-tint text-primary text-[11px] font-bold shrink-0">
                  {items.length}
                </span>
              </div>
              <div className="p-3 space-y-3 max-h-[600px] overflow-y-auto">
                {isLoading && items.length === 0 && <p className="text-[12px] text-muted-foreground px-1">Loading…</p>}
                {!isLoading && items.length === 0 && <p className="text-[12px] text-muted-foreground px-1">No orders.</p>}
                {items.map((o) => {
                  const red = o.alerts.length > 0;
                  return (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => setSelectedId(o.id)}
                      className={`w-full text-left bg-card rounded-[12px] p-3 shadow-sm border transition-colors ${
                        red ? "border-destructive ring-1 ring-destructive/40" : "border-border hover:border-primary"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-[13px] font-bold text-foreground truncate">{o.merchantName}</p>
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {o.orderNumber || `#${o.id.slice(0, 6)}`}
                        </span>
                      </div>
                      <div className="text-[12px] flex items-center gap-1 text-muted-foreground mb-1 min-w-0">
                        <User size={12} className="shrink-0" />
                        <span className="truncate">{o.customerName}</span>
                      </div>
                      <div className="text-[12px] mb-1.5 min-w-0"><RiderLine o={o} /></div>
                      <div className="text-[12px] text-muted-foreground flex items-center justify-between gap-2">
                        <span className="truncate">{STATUS_LABEL[o.status]} · {ago(o.createdAt, now)}</span>
                        <span className="font-semibold text-foreground shrink-0">{inr.format(o.totalAmount)}</span>
                      </div>
                      {red && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {o.alerts.map((a) => (
                            <span key={a} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold px-2 py-0.5">
                              <AlertTriangle size={10} /> {ALERT_LABEL[a]}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <OrderSheet order={selected} canManage={!!data?.canManage} onClose={() => setSelectedId(null)} />
      )}
    </section>
  );
}
