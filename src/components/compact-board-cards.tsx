import { MoreHorizontal } from "lucide-react";
import type { PipelineBooking, PipelineStatus } from "@/lib/live-orders.functions";
import type { CommerceOrder } from "@/lib/commerce.functions";
import type { CourierOrderRow } from "@/lib/courier.functions";

const inr = (n: number | null | undefined) => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
const dayTime = (date: string | null, slot: string | null) => {
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

function Shell({ onOpen, flag, children }: { onOpen: () => void; flag?: string | null; children: React.ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={`relative bg-card rounded-[12px] px-3 py-2.5 shadow-sm border cursor-pointer space-y-0.5 ${flag ? "border-destructive" : "border-border hover:border-primary/60"}`}
    >
      {children}
      {flag && (
        <span className="inline-block mt-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive whitespace-nowrap">
          {flag}
        </span>
      )}
    </div>
  );
}

function Top({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[13px] font-bold text-foreground truncate">{name}</p>
      <button
        type="button"
        aria-label="More"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className="shrink-0 -mr-1 h-6 w-6 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

const line = "text-[12px] text-muted-foreground truncate";

function Bottom({ left, action, onAction }: { left: React.ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-0.5">
      <span className="text-[12px] font-semibold text-foreground truncate">{left}</span>
      {action && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAction?.(); }}
          className="shrink-0 h-7 px-3 rounded-full bg-primary text-primary-foreground text-[11px] font-bold"
        >
          {action}
        </button>
      )}
    </div>
  );
}

export function CompactBookingCard({ b, col, now, onOpen }: { b: PipelineBooking; col: PipelineStatus; now: number; onOpen: () => void }) {
  const wait = mins(b.broadcastStartedAt ?? b.createdAt, now);
  const service = b.serviceLabel ?? (b.serviceDurationMinutes ? `${b.serviceDurationMinutes} min` : "Service");
  const expert = b.assignedExpertName?.trim() || "Not assigned";
  const third =
    col === "accepted" ? <span className={wait >= 10 ? "text-destructive font-semibold" : ""}>⏱ {wait} min</span>
    : col === "completed" ? `✓ ${clock(b.serviceEndAt ?? b.updatedAt)} · ${expert}`
    : `Expert: ${expert}`;
  const status =
    col === "completed" ? inr(b.totalAmount)
    : col === "in_progress" ? (b.arrivedAt ? `Arrived ${clock(b.arrivedAt)}` : b.onTheWayAt ? `On the way ${clock(b.onTheWayAt)}` : "In progress")
    : inr(b.totalAmount);
  const flag = b.dispatchExhaustedAt && col === "accepted" ? "No Expert found" : null;
  return (
    <Shell onOpen={onOpen} flag={flag}>
      <Top name={b.customerName} onOpen={onOpen} />
      <p className={line}>{dayTime(b.scheduledDate, b.scheduledTimeSlot, b.slotType)} : {service}</p>
      <p className={line}>{third}</p>
      <Bottom left={status} action={col === "accepted" ? "Assign" : undefined} onAction={onOpen} />
    </Shell>
  );
}

const COMMERCE_STATUS: Record<string, string> = {
  pending: "New", accepted: "Accepted", preparing: "Preparing", ready: "Ready",
  picked_up: "Picked up", out_for_delivery: "On the way", completed: "Delivered",
};

export function CompactCommerceCard({ o, col, now, onOpen }: { o: CommerceOrder; col: PipelineStatus; now: number; onOpen: () => void }) {
  const wait = mins(o.createdAt, now);
  const third =
    col === "accepted" ? <span className={wait >= 5 ? "text-destructive font-semibold" : ""}>⏱ {wait} min</span>
    : col === "completed" ? `✓ ${clock(o.pickedUpAt ?? o.createdAt)}`
    : `Rider: ${o.riderName ? first(o.riderName) : "—"}`;
  const flag = o.alerts.length ? o.alerts.map((a) => ALERT_LABEL[a] ?? a).join(" · ") : null;
  return (
    <Shell onOpen={onOpen} flag={flag}>
      <Top name={o.customerName} onOpen={onOpen} />
      <p className={line}>{o.merchantName}</p>
      <p className={line}>{third}</p>
      <Bottom left={col === "accepted" || col === "completed" ? inr(o.paidAmount || o.totalAmount) : COMMERCE_STATUS[o.status] ?? o.status} />
    </Shell>
  );
}

const COURIER_STATUS: Record<string, string> = {
  DRIVER_ASSIGNED: "Rider assigned", ARRIVED_PICKUP: "At pickup", PICKED_UP: "Picked up", IN_TRANSIT: "On the way",
};

export function CompactCourierCard({ o, col, now, onOpen }: { o: CourierOrderRow; col: PipelineStatus; now: number; onOpen: () => void }) {
  const wait = mins(o.created_at, now);
  const third =
    col === "accepted" ? <span className={wait >= 10 ? "text-destructive font-semibold" : ""}>⏱ {wait} min</span>
    : col === "completed" ? "✓ Delivered"
    : `Rider: ${first(o.riderName)}`;
  return (
    <Shell onOpen={onOpen} flag={o.needs_ops_attention ? "Needs attention" : null}>
      <Top name={o.customerName ?? "Customer"} onOpen={onOpen} />
      <p className={line}>Parcel</p>
      <p className={line}>{third}</p>
      <Bottom left={col === "in_progress" || col === "expert_assigned" ? COURIER_STATUS[o.status] ?? o.status : inr(o.total_amount)}
        action={col === "accepted" ? "Assign" : undefined} onAction={onOpen} />
    </Shell>
  );
}
