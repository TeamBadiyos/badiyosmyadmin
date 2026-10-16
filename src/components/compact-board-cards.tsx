import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getDispatchConfig,
  listActiveExperts,
  assignExpertToBooking,
  type PipelineBooking,
  type PipelineStatus,
} from "@/lib/live-orders.functions";
import { listCourierRiders, reassignRider, type CourierOrderRow } from "@/lib/courier.functions";
import type { CommerceOrder } from "@/lib/commerce.functions";

// Same no-accept limit as Settings → Alerts.
export function useWaitLimit(svc: "maid" | "wash" | "store" | "food" | "parcel") {
  const fn = useServerFn(getDispatchConfig);
  const q = useQuery({ queryKey: ["dispatch-config"], queryFn: () => fn(), staleTime: 60_000 });
  const v = q.data?.noAcceptByService?.[svc];
  return v && v > 0 ? v : (q.data?.noAcceptMinutes ?? Number.POSITIVE_INFINITY);
}

const inr = (n: number | null | undefined) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
const dayTime = (date: string | null, slot: string | null, slotType?: string | null) => {
  if (!date && (slotType ?? "").toLowerCase() === "now") return "Now";
  const d = date ? new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" }) : "";
  const t = (slot ?? "").split(/\s*[-–(]/)[0].trim();
  return [d, t].filter(Boolean).join(" ") || "—";
};
const mins = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
const first = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || "—";

const ALERT_LABEL: Record<string, string> = {
  merchant_slow: "Merchant slow",
  no_rider: "No rider",
  pickup_delayed: "Pickup delayed",
};

/** Fixed 4-line card. `late` turns the whole card red (over the wait limit). */
function Shell({ onOpen, late, children }: { onOpen: () => void; late?: boolean; children: React.ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`relative h-[100px] flex flex-col justify-between rounded-[12px] px-3 py-2 shadow-sm border cursor-pointer ${late ? "bg-destructive/10 border-destructive" : "bg-card border-border hover:border-primary/60"}`}
    >
      {children}
    </div>
  );
}

function Top({ name, flag, onOpen }: { name: string; flag?: string | null; onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <p className="text-[13px] font-bold text-foreground truncate">{name}</p>
      <div className="flex items-center gap-1 shrink-0 min-w-0">
        {flag && (
          <span className="max-w-[110px] truncate rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive" title={flag}>
            {flag}
          </span>
        )}
        <button
          type="button"
          aria-label="More"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="-mr-1 h-6 w-6 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    </div>
  );
}

const line = "text-[12px] text-muted-foreground truncate leading-4";

function Timer({ wait, late }: { wait: number; late: boolean }) {
  return <span className={late ? "text-destructive font-semibold" : "text-muted-foreground"}>⏱ Waiting {wait} min</span>;
}

function Bottom({ left, action }: { left: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 h-6">
      <span className="text-[12px] font-semibold text-foreground truncate">{left}</span>
      {action}
    </div>
  );
}

type Candidate = { id: string; name: string; distanceKm: number | null; tag: string; good: boolean };

/** Small on-card picker: nearest first, one click assigns with a 5s undo. */
function AssignPopover({
  queryKey,
  load,
  assign,
  onSeeAll,
  invalidate,
}: {
  queryKey: readonly unknown[];
  load: () => Promise<Candidate[]>;
  assign: (id: string) => Promise<unknown>;
  onSeeAll: () => void;
  invalidate: readonly unknown[][];
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const timer = useRef<number | null>(null);
  const q = useQuery({ queryKey, queryFn: load, enabled: open, staleTime: 15_000 });
  const list = q.data ?? [];

  function pick(c: Candidate) {
    setOpen(false);
    let undone = false;
    const id = toast(`Assigning ${c.name}…`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          if (timer.current) window.clearTimeout(timer.current);
          toast.info("Assignment undone");
        },
      },
    });
    timer.current = window.setTimeout(async () => {
      if (undone) return;
      try {
        await assign(c.id);
        toast.success(`${c.name} assigned`, { id });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not assign", { id });
      } finally {
        invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      }
    }, 5000);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 h-6 px-2.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold"
        >
          Assign
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" onClick={(e) => e.stopPropagation()}>
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Nearest first</p>
        {q.isLoading && <p className="px-2 py-2 text-[12px] text-muted-foreground">Loading…</p>}
        {q.isError && <p className="px-2 py-2 text-[12px] text-destructive">Couldn't load the list.</p>}
        {!q.isLoading && !q.isError && list.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-muted-foreground">Nobody free right now.</p>
        )}
        <div className="max-h-56 overflow-y-auto">
          {list.slice(0, 6).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c)}
              className="w-full flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-muted"
            >
              <span className="text-[13px] font-semibold text-foreground truncate">{c.name}</span>
              <span className="shrink-0 flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">{c.distanceKm != null ? `${c.distanceKm.toFixed(1)} km` : "— km"}</span>
                <span className={`rounded-full px-1.5 py-0.5 font-bold ${c.good ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{c.tag}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); onSeeAll(); }}
          className="mt-1 w-full rounded-[8px] px-2 py-1.5 text-[12px] font-bold text-primary hover:bg-muted text-left"
        >
          See all →
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function CompactBookingCard({ b, col, now, onOpen, svc }: { b: PipelineBooking; col: PipelineStatus; now: number; onOpen: () => void; svc?: "maid" | "wash" }) {
  const wait = mins(b.broadcastStartedAt ?? b.createdAt, now);
  const limit = useWaitLimit(svc ?? "maid");
  const fetchExperts = useServerFn(listActiveExperts);
  const assignFn = useServerFn(assignExpertToBooking);
  const isNew = col === "accepted";
  const late = isNew && wait >= limit;
  const service = b.serviceLabel ?? (b.serviceDurationMinutes ? `${b.serviceDurationMinutes} min` : "Service");
  const expert = b.assignedExpertName?.trim() || "Not assigned";
  const third =
    isNew ? <Timer wait={wait} late={late} />
    : col === "completed" ? `✓ ${clock(b.serviceEndAt ?? b.updatedAt)} · ${expert}`
    : `Expert: ${expert}`;
  const status =
    col === "in_progress" ? (b.arrivedAt ? `Arrived ${clock(b.arrivedAt)}` : b.onTheWayAt ? `On the way ${clock(b.onTheWayAt)}` : "In progress")
    : inr(b.totalAmount);
  const flag = b.dispatchExhaustedAt && isNew ? "No Expert found" : null;
  return (
    <Shell onOpen={onOpen} late={late}>
      <Top name={b.customerName} flag={flag} onOpen={onOpen} />
      <p className={line}>{dayTime(b.scheduledDate, b.scheduledTimeSlot, b.slotType)} : {service}</p>
      <p className={line}>{third}</p>
      <Bottom
        left={status}
        action={isNew ? (
          <AssignPopover
            queryKey={["bookings", "assignable-experts", b.id]}
            load={async () => (await fetchExperts({ data: { bookingId: b.id } })).map((e) => {
              const busy = !!(e as { busy?: boolean }).busy;
              return { id: e.id, name: e.name, distanceKm: e.distanceKm ?? null, tag: busy ? "Busy" : "Free", good: !busy };
            })}
            assign={(id) => assignFn({ data: { bookingId: b.id, expertId: id } })}
            onSeeAll={onOpen}
            invalidate={[["pipeline"], ["bookings"], ["dashboard", "stats"]]}
          />
        ) : undefined}
      />
    </Shell>
  );
}

const COMMERCE_STATUS: Record<string, string> = {
  pending: "New", accepted: "Accepted", preparing: "Preparing", ready: "Ready",
  picked_up: "Picked up", out_for_delivery: "On the way", completed: "Delivered",
};

export function CompactCommerceCard({ o, col, now, onOpen, svc }: { o: CommerceOrder; col: PipelineStatus; now: number; onOpen: () => void; svc?: "store" | "food" }) {
  const wait = mins(o.createdAt, now);
  const limit = useWaitLimit(svc ?? "store");
  const isNew = col === "accepted";
  const late = isNew && wait >= limit;
  const third =
    isNew ? <Timer wait={wait} late={late} />
    : col === "completed" ? `✓ ${clock(o.pickedUpAt ?? o.createdAt)}`
    : `Rider: ${o.riderName ? first(o.riderName) : "—"}`;
  const flag = o.alerts.length ? o.alerts.map((a) => ALERT_LABEL[a] ?? a).join(" · ") : null;
  return (
    <Shell onOpen={onOpen} late={late}>
      <Top name={o.customerName} flag={flag} onOpen={onOpen} />
      <p className={line}>{o.merchantName}</p>
      <p className={line}>{third}</p>
      <Bottom left={isNew || col === "completed" ? inr(o.paidAmount || o.totalAmount) : COMMERCE_STATUS[o.status] ?? o.status} />
    </Shell>
  );
}

const COURIER_STATUS: Record<string, string> = {
  DRIVER_ASSIGNED: "Rider assigned", ARRIVED_PICKUP: "At pickup", PICKED_UP: "Picked up", IN_TRANSIT: "On the way",
};

export function CompactCourierCard({ o, col, now, onOpen }: { o: CourierOrderRow; col: PipelineStatus; now: number; onOpen: () => void }) {
  const wait = mins(o.created_at, now);
  const limit = useWaitLimit("parcel");
  const fetchRiders = useServerFn(listCourierRiders);
  const assignFn = useServerFn(reassignRider);
  const isNew = col === "accepted";
  const late = isNew && wait >= limit;
  const third =
    isNew ? <Timer wait={wait} late={late} />
    : col === "completed" ? "✓ Delivered"
    : `Rider: ${first(o.riderName)}`;
  return (
    <Shell onOpen={onOpen} late={late}>
      <Top name={o.customerName ?? "Customer"} flag={o.needs_ops_attention ? "Needs attention" : null} onOpen={onOpen} />
      <p className={line}>Parcel</p>
      <p className={line}>{third}</p>
      <Bottom
        left={col === "in_progress" || col === "expert_assigned" ? COURIER_STATUS[o.status] ?? o.status : inr(o.total_amount)}
        action={isNew ? (
          <AssignPopover
            queryKey={["courier", "riders", o.id]}
            load={async () => (await fetchRiders({ data: { orderId: o.id } }))
              .map((r) => ({ id: r.id, name: r.name, distanceKm: r.distance_km, tag: r.is_online ? "Free" : "Offline", good: r.is_online }))
              .sort((a, b) => Number(b.good) - Number(a.good) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))}
            assign={(id) => assignFn({ data: { orderId: o.id, expertId: id } })}
            onSeeAll={onOpen}
            invalidate={[["pipeline"], ["courier"]]}
          />
        ) : undefined}
      />
    </Shell>
  );
}
