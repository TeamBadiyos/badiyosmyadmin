/**
 * Shared building blocks for every booking / order detail panel
 * (Clean Home, Clean Auto, Store, Food, Parcel) so they all share one layout:
 * header (info only) → customer → map + labelled map actions → two columns
 * (assigned person + payment | staff note) → action bar → History ▸.
 */
import { useEffect, useState } from "react";
import { Copy, MapPin, MessageCircle, Bike, Pencil, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useLiveTracking } from "@/lib/use-live-tracking";

function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
async function copyText(text: string, ok = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("Could not copy");
  }
}

/** Formats an Indian phone as +91 98765 43210. */
export function fmtPhone(p: string | null | undefined): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  const ten = d.length >= 10 ? d.slice(-10) : d;
  if (ten.length !== 10) return p;
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function PanelSection({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-border bg-background px-3 py-2.5">
      {(title || right) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {title && <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>}
          {right}
        </div>
      )}
      <div className="space-y-1">{children}</div>
    </section>
  );
}

/** Customer block: name + New/Nth badge + rating given, phone + Call/WhatsApp, address lines. */
export function CustomerBlock({
  name, phone, masked, bookingCount, avgRatingGiven, address, contact,
}: {
  name: string | null;
  phone: string | null;
  masked?: boolean;
  bookingCount?: number | null;
  avgRatingGiven?: number | null;
  address?: { label?: string | null; fullAddress?: string | null; area?: string | null; city?: string | null; pincode?: string | null } | null;
  contact?: React.ReactNode;
}) {
  return (
    <PanelSection title="Customer">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[14px] font-semibold text-foreground">{name ?? "—"}</p>
            {bookingCount != null && bookingCount > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${bookingCount <= 1 ? "bg-primary/10 text-primary" : "bg-muted text-foreground"}`}>
                {bookingCount <= 1 ? "New customer" : `${ordinal(bookingCount)} booking`}
              </span>
            )}
            {avgRatingGiven != null && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-foreground">★ {avgRatingGiven.toFixed(1)} given</span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">{masked ? phone ?? "—" : fmtPhone(phone)}</p>
        </div>
        {contact}
      </div>
      {address !== undefined && (
        address ? (
          <div className="pt-1 text-[12px] leading-snug">
            {address.label && <p className="font-semibold text-foreground">{address.label}</p>}
            {address.fullAddress && <p className="text-foreground">{address.fullAddress}</p>}
            <p className="text-muted-foreground">{[address.area, address.city, address.pincode].filter(Boolean).join(", ") || "—"}</p>
          </div>
        ) : (
          <p className="pt-1 text-[12px] text-muted-foreground">No address on this order.</p>
        )
      )}
    </PanelSection>
  );
}

const barBtn =
  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-card text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none";

/** One row of labelled buttons under the map. */
export function MapActionBar({
  kind, id, parcel = false, onUpdatePin, onEditAddress,
}: {
  kind: "booking" | "courier";
  id: string;
  parcel?: boolean;
  onUpdatePin?: () => void;
  onEditAddress?: () => void;
}) {
  const { data } = useLiveTracking(kind, id);
  const code = data?.code ?? "";
  const agent = data?.agent;
  const drop = data?.drop;
  const pickup = data?.pickup;
  const agentOk = agent?.lat != null && agent?.lng != null;
  const who = kind === "courier" ? "rider" : "expert";
  const jobMsg = drop?.lat != null && drop?.lng != null
    ? `Badiyos ${code} — ${parcel ? "Drop" : "Job location"}${drop.address ? `: ${drop.address}` : ""}\n${mapsLink(drop.lat, drop.lng)}`
    : null;
  const pickMsg = pickup?.lat != null && pickup?.lng != null
    ? `Badiyos ${code} — Pick-up${pickup.address ? `: ${pickup.address}` : ""}\n${mapsLink(pickup.lat, pickup.lng)}`
    : null;
  const shareMsg = parcel && pickMsg && jobMsg ? `${pickMsg}\n\n${jobMsg}` : jobMsg;
  const agentMsg = agentOk
    ? `Badiyos ${code} — ${agent?.name ?? "Partner"} live location${agent?.phone ? ` (${agent.phone})` : ""}: ${mapsLink(agent!.lat!, agent!.lng!)}`
    : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      {parcel ? (
        <>
          <button type="button" className={barBtn} disabled={!pickMsg} onClick={() => pickMsg && copyText(pickMsg, "Pickup copied")}><Copy size={13} /> Copy pickup</button>
          <button type="button" className={barBtn} disabled={!jobMsg} onClick={() => jobMsg && copyText(jobMsg, "Drop copied")}><Copy size={13} /> Copy drop</button>
        </>
      ) : (
        <button type="button" className={barBtn} disabled={!jobMsg} onClick={() => jobMsg && copyText(jobMsg, "Job location copied")}><Copy size={13} /> Copy job location</button>
      )}
      <a
        href={shareMsg ? `https://wa.me/?text=${encodeURIComponent(shareMsg)}` : undefined}
        target="_blank" rel="noreferrer" aria-disabled={!shareMsg}
        className={`${barBtn} ${shareMsg ? "" : "pointer-events-none opacity-40"}`}
      >
        <MessageCircle size={13} /> {parcel ? "Share on WhatsApp" : "Share job location"}
      </a>
      <button type="button" className={barBtn} disabled={!agentMsg} onClick={() => agentMsg && copyText(agentMsg, "Live location copied")}>
        <Bike size={13} /> Copy {who} live location
      </button>
      {onUpdatePin && <button type="button" className={barBtn} onClick={onUpdatePin}><MapPin size={13} /> Update map pin</button>}
      {onEditAddress && <button type="button" className={barBtn} onClick={onEditAddress}><Pencil size={13} /> Edit address</button>}
    </div>
  );
}

/** Action button: primary (green, larger), normal, or danger (red). */
export function ActionBtn({
  variant = "normal", icon, children, onClick, disabled, title,
}: {
  variant?: "primary" | "normal" | "danger";
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const cls =
    variant === "primary"
      ? "h-10 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-bold"
      : variant === "danger"
        ? "h-9 px-3 rounded-full border border-destructive/50 text-destructive text-[12px] font-bold hover:bg-destructive/10"
        : "h-9 px-3 rounded-full border border-border bg-card text-foreground text-[12px] font-semibold hover:bg-muted";
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none ${cls}`}>
      {icon}
      {children}
    </button>
  );
}

/** Three groups: primary · normal · danger (far right). Groups with no buttons are dropped. */
export function ActionBar({ primary, normal, danger }: { primary?: React.ReactNode; normal?: React.ReactNode; danger?: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
      {primary && <div className="flex flex-wrap items-center gap-1.5">{primary}</div>}
      {normal && <div className="flex flex-wrap items-center gap-1.5">{normal}</div>}
      {danger && <div className="ml-auto flex flex-wrap items-center gap-1.5">{danger}</div>}
    </section>
  );
}

export type HistoryItem = { at: string; what: string; who?: string | null };

export function HistorySection({ items, loading }: { items: HistoryItem[]; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const sorted = [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <section className="rounded-[14px] border border-border">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} History
        <span className="ml-1 font-semibold normal-case tracking-normal">({items.length})</span>
      </button>
      {open && (
        <ol className="max-h-64 space-y-1.5 overflow-y-auto px-3 pb-3">
          {loading && <li className="text-[12px] text-muted-foreground">Loading…</li>}
          {!loading && sorted.length === 0 && <li className="text-[12px] text-muted-foreground">Nothing recorded yet.</li>}
          {sorted.map((h, i) => (
            <li key={i} className="text-[12px] leading-snug">
              <span className="font-semibold text-foreground">{h.what}</span>
              <span className="ml-2 text-muted-foreground">
                {new Date(h.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}
                {" · "}{h.who || "System"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

/** Compact timer row for running jobs: time left, thin progress bar, started · expected end. */
export function TimerRow({ startedAt, totalMinutes }: { startedAt: string; totalMinutes: number }) {
  const now = useNow();
  const start = new Date(startedAt).getTime();
  const end = start + totalMinutes * 60_000;
  const left = Math.round((end - now) / 60_000);
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start || 1)) * 100));
  const over = left < 0;
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  return (
    <div className="mt-2 flex items-center gap-3 text-[12px]">
      <span className={`shrink-0 font-bold ${over ? "text-destructive" : "text-foreground"}`}>
        {over ? `${fmt(-left)} over` : `${fmt(left)} left`}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${over ? "bg-destructive" : "bg-primary"}`} style={{ width: `${over ? 100 : pct}%` }} />
      </div>
      <span className="shrink-0 text-muted-foreground">Started {clock(new Date(start))} · ends {clock(new Date(end))}</span>
    </div>
  );
}

/** Status steps on one line. */
export function StepLine({ steps, current, bad }: { steps: Array<{ key: string; label: string }>; current: string; bad?: string | null }) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <ol className="mt-2 flex w-full min-w-0 items-center gap-0.5">
      {steps.map((s, i) => (
        <li key={s.key} className="flex min-w-0 flex-1 items-center gap-0.5 last:flex-none">
          <span title={s.label} className={`truncate rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
            !bad && i === idx ? "bg-primary-tint text-primary" : !bad && i < idx ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px min-w-[4px] flex-1 bg-border" />}
        </li>
      ))}
      {bad && <li className="ml-1 shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{bad}</li>}
    </ol>
  );
}
