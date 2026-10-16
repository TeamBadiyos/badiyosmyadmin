import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Ban, Bike, MoreHorizontal, RefreshCw, Store, User, Volume2, VolumeX, X } from "lucide-react";
import { ActionBar, ActionBtn, CustomerBlock, HistorySection, MapActionBar, PanelSection, PhaseBanner, waitText } from "@/components/detail-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LiveTrackingMap } from "@/components/live-tracking-map";
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
import { OrderPaymentSummary } from "@/components/order-payment-summary";
import { ContactButtons } from "@/components/booking-details-modal";
import { AssignPopover, riderOpt } from "@/components/compact-board-cards";
import { listCourierRiders, reassignRider } from "@/lib/courier.functions";

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

const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

export function CommerceCard({ o, now, onOpen }: { o: CommerceOrder; now: number; onOpen: () => void }) {
  const red = o.alerts.length > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
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
      <p className="truncate text-[12px] text-muted-foreground">
        {STATUS_LABEL[o.status]} · {ago(o.createdAt, now)}
      </p>
      <OrderPaymentSummary className="mt-1.5" paid={o.paidAmount} base={o.itemsTotal} coupon={o.discountAmount} delivery={o.deliveryFee} />
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
}

export function OrderSheet({
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
  const fetchRiders = useServerFn(listCourierRiders);
  const assignRider = useServerFn(reassignRider);
  const cancel = useServerFn(cancelStoreOrderWithRefund);
  const [mode, setMode] = useState<"none" | "rider" | "cancel">("none");
  const [reason, setReason] = useState("");
  const [showSplit, setShowSplit] = useState(false);

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

  const steps: CommerceStatus[] = ["pending", "accepted", "preparing", "ready", "completed"];
  const curIdx = steps.indexOf(order.status);
  const paidLabel = order.paymentStatus === "paid" ? "Paid" : order.paymentStatus ?? "—";

  const history = [
    { at: order.createdAt, what: "Order placed", who: order.customerName },
    ...(order.acceptedAt ? [{ at: order.acceptedAt, what: "Accepted by store", who: order.merchantName }] : []),
    ...(order.readyAt ? [{ at: order.readyAt, what: "Ready for pickup", who: order.merchantName }] : []),
    ...(order.pickedUpAt ? [{ at: order.pickedUpAt, what: "Picked up by rider", who: order.riderName }] : []),
  ];
  const canAssignRider = canManage && !closed && !!order.courierOrderId && (order.riderState === "searching" || order.riderState === "assigned");

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50" onClick={onClose}>
      <div
        className="bg-card w-full sm:max-w-[880px] h-[100dvh] sm:h-auto max-h-[100dvh] sm:max-h-[94dvh] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[17px] font-bold text-foreground">{order.orderNumber || `#${order.id.slice(0, 6)}`}</h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-primary-tint text-primary">
                {STATUS_LABEL[order.status]}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-foreground">{order.merchantName}</span>
              <span className="text-[13px] font-bold text-foreground">{inr.format(order.paidAmount || order.totalAmount)}</span>
              <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${order.paymentStatus === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{paidLabel}</span>
            </div>
            <button onClick={onClose} aria-label="Close" className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted">
              <X size={18} />
            </button>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground truncate">
            Placed {ago(order.createdAt, now)}{order.readyAt ? ` · Ready ${ago(order.readyAt, now)}` : ""} · {order.paymentMode ?? "—"}
          </p>
          {order.status === "completed"
            ? <PhaseBanner phase="done" title="✓ Completed" detail={order.riderName ? `by ${order.riderName}` : null} />
            : order.status === "pending"
              ? <PhaseBanner phase="assign" title="Waiting for store to accept" detail={`Waiting ${waitText(order.createdAt, now)}`} />
              : <PhaseBanner phase={order.riderName ? "assigned" : "assign"}
                  title={order.riderName ? `${STATUS_LABEL[order.status]} · Rider ${order.riderName}` : `${STATUS_LABEL[order.status]} · finding rider`}
                  steps={steps.filter((k) => k !== "pending").map((k) => ({ key: k, label: STATUS_LABEL[k] }))} current={order.status} />}
          {order.alerts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {order.alerts.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold px-2 py-1">
                  <AlertTriangle size={11} /> {ALERT_LABEL[a]}
                </span>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 pt-3 pb-16 sm:pb-4 space-y-3">
          <CustomerBlock
            name={order.customerName}
            phone={order.customerPhone}
            masked={order.phoneMasked}
            contact={order.customerPhone && !order.phoneMasked ? <ContactButtons phone={order.customerPhone} /> : null}
          />

          {order.courierOrderId ? (
            <div>
              <LiveTrackingMap kind="courier" id={order.courierOrderId} panel />
              <MapActionBar kind="courier" id={order.courierOrderId} />
            </div>
          ) : (
            <div className="h-[200px] rounded-[12px] border border-border bg-muted grid place-items-center text-[12px] text-muted-foreground">
              Map shows once a delivery is created
            </div>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PanelSection title="Assigned rider">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] min-w-0">{order.riderName ? <span className="font-semibold text-foreground">{order.riderName}</span> : <span className="italic text-muted-foreground">Not assigned</span>}</p>
                {canAssignRider && (
                  <AssignPopover
                    queryKey={["courier", "riders", order.courierOrderId as string]}
                    load={async () => (await fetchRiders({ data: { orderId: order.courierOrderId as string } })).map(riderOpt)}
                    assign={(id) => assignRider({ data: { orderId: order.courierOrderId as string, expertId: id } })}
                    onSeeAll={() => {}}
                    invalidate={[["commerce"], ["pipeline"], ["courier"]]}
                  />
                )}
              </div>
              <p className="text-[12px] text-muted-foreground"><RiderLine o={order} /></p>
            </PanelSection>
            <PanelSection
              title="Payment"
              right={<button type="button" onClick={() => setShowSplit((v) => !v)} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground">Split {showSplit ? "▾" : "▸"}</button>}
            >
              <div className="flex justify-between text-[13px]"><span className="text-muted-foreground">Items</span><span>{inr2.format(order.itemsTotal)}</span></div>
              <div className="flex justify-between text-[13px]"><span className="text-muted-foreground">Delivery</span><span>{inr2.format(order.deliveryFee)}</span></div>
              {order.discountAmount > 0 && <div className="flex justify-between text-[13px]"><span className="text-muted-foreground">Discount</span><span>− {inr2.format(order.discountAmount)}</span></div>}
              <div className="flex justify-between border-t border-border pt-1 text-[13px] font-bold"><span>Total</span><span>{inr.format(order.paidAmount || order.totalAmount)}</span></div>
              <p className="text-[12px] text-muted-foreground">{paidLabel} · {order.paymentMode ?? "—"}</p>
              {showSplit && (
                <p className="text-[12px] text-muted-foreground">
                  Commission ({order.commissionPct}%) − {inr2.format(order.commissionAmount)} · GST on commission − {inr2.format(order.commissionGstAmount)} · Merchant gets {inr2.format(order.merchantNet)}
                </p>
              )}
            </PanelSection>
          </section>

          {canManage && !closed ? (
            <ActionBar
              normal={
                <>
                  {canReassign && <ActionBtn icon={<RefreshCw size={13} />} onClick={() => setMode(mode === "rider" ? "none" : "rider")}>Restart rider search</ActionBtn>}
                </>
              }
              danger={<ActionBtn variant="danger" icon={<Ban size={13} />} onClick={() => setMode("cancel")}>Cancel</ActionBtn>}
            />
          ) : !canManage ? (
            <p className="text-[12px] text-muted-foreground">Only super admin or ops manager can change this order.</p>
          ) : null}

          {canManage && !closed && mode === "rider" && (
            <div className="rounded-[14px] border border-border p-3 space-y-2">
              <p className="text-[12px] text-foreground">
                The rider search will restart and the nearest free rider will be offered this job. If the old delivery was cancelled, a new one is created.
              </p>
              <div className="flex gap-2">
                <button disabled={reassignM.isPending} onClick={() => reassignM.mutate()}
                  className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">
                  {reassignM.isPending ? "Searching…" : "Re-search rider"}
                </button>
                <button onClick={() => setMode("none")} className="h-9 px-4 rounded-full border border-border text-[13px] font-semibold">Back</button>
              </div>
            </div>
          )}

          {canManage && !closed && mode === "cancel" && (
            <div className="rounded-[14px] border border-destructive/40 p-3 space-y-2">
              <p className="text-[12px] text-foreground">
                The order will be cancelled and the full paid amount refunded to the customer. The delivery will also be cancelled.
              </p>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" rows={2}
                className="w-full rounded-[10px] border border-border bg-background p-2 text-[13px]" />
              <div className="flex gap-2">
                <button disabled={!reason.trim() || cancelM.isPending} onClick={() => cancelM.mutate()}
                  className="h-9 px-4 rounded-full bg-destructive text-destructive-foreground text-[13px] font-bold disabled:opacity-50">
                  {cancelM.isPending ? "Cancelling…" : "Confirm cancel + full refund"}
                </button>
                <button onClick={() => setMode("none")} className="h-9 px-4 rounded-full border border-border text-[13px] font-semibold">Back</button>
              </div>
            </div>
          )}

          <HistorySection items={history} />
        </div>
      </div>
    </div>
  );
}

export function CommerceKanban({ segmentId, service = null }: { segmentId: string | null; service?: "store" | "food" | null }) {
  const queryClient = useQueryClient();
  const fetchPipeline = useServerFn(listCommercePipeline);

  const [training, setTraining] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["commerce", "board", segmentId, service, training],
    queryFn: () => fetchPipeline({ data: { segmentId, training, service } }),
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
            {training ? "Training store orders only — safe to test." : "Live store orders with rider status. Click a card for actions."}
          </p>
          <div className="mt-2 inline-flex rounded-full border border-border p-0.5 text-[12px] font-bold">
            <button onClick={() => setTraining(false)} className={`px-3 h-7 rounded-full ${!training ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Live</button>
            <button onClick={() => setTraining(true)} className={`px-3 h-7 rounded-full ${training ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>Training</button>
          </div>
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

      <div className="grid gap-4 grid-cols-[repeat(5,minmax(78vw,1fr))] sm:grid-cols-[repeat(5,minmax(220px,1fr))] overflow-x-auto overscroll-x-contain board-swipe -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2">
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
                {items.map((o) => <CommerceCard key={o.id} o={o} now={now} onOpen={() => setSelectedId(o.id)} />)}
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

