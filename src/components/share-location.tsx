import { useQueryClient } from "@tanstack/react-query";
import { Copy, MapPin, MessageCircle, Bike, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useLiveTracking, isStale } from "@/lib/use-live-tracking";

function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function agoLabel(iso: string | null | undefined): string {
  if (!iso) return "no GPS yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copied — paste in WhatsApp");
  } catch {
    toast.error("Could not copy link");
  }
}

function Row({
  icon,
  title,
  lat,
  lng,
  message,
  emptyText,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  message: (url: string) => string;
  emptyText: string;
  note?: React.ReactNode;
}) {
  const ok = lat != null && lng != null;
  const url = ok ? mapsLink(lat!, lng!) : "";
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-primary shrink-0">{icon}</span>
      <span className="text-[12px] font-semibold text-foreground flex-1 min-w-0 truncate">
        {title}
        {!ok && <span className="ml-1 font-normal text-muted-foreground">· {emptyText}</span>}
        {ok && note}
      </span>
      <button
        type="button"
        disabled={!ok}
        onClick={() => copy(message(url))}
        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full border border-border text-[12px] font-semibold text-foreground disabled:opacity-40"
      >
        <Copy size={12} /> Copy
      </button>
      <a
        href={ok ? `https://wa.me/?text=${encodeURIComponent(message(url))}` : undefined}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!ok}
        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-full bg-primary text-primary-foreground text-[12px] font-semibold ${ok ? "" : "pointer-events-none opacity-40"}`}
      >
        <MessageCircle size={12} /> WhatsApp
      </a>
    </div>
  );
}

export function ShareLocation({ kind, id }: { kind: "booking" | "courier"; id: string }) {
  const qc = useQueryClient();
  const { data, isFetching } = useLiveTracking(kind, id);

  const agent = data?.agent;
  const code = data?.code ?? "";
  const hasFix = agent?.lat != null && agent?.lng != null;
  const stale = hasFix && isStale(agent?.updatedAt);

  return (
    <div className="mb-3 rounded-[14px] border border-border p-3">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Share location
        </p>
        {hasFix && !stale && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live GPS
          </span>
        )}
        <button
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ["tracking", kind, id] })}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <Row
        icon={<Bike size={14} />}
        title={`${kind === "courier" ? "Rider" : "Expert"} live location${agent?.name ? ` (${agent.name})` : ""}`}
        lat={agent?.lat}
        lng={agent?.lng}
        emptyText={agent ? "Waiting for GPS" : "Not assigned yet"}
        note={
          <span
            className={`ml-1 font-normal ${stale ? "text-amber-600" : "text-muted-foreground"}`}
          >
            · {agoLabel(agent?.updatedAt)}
          </span>
        }
        message={(u) =>
          `Badiyos ${code} — ${agent?.name ?? "Partner"} live location${agent?.phone ? ` (${agent.phone})` : ""}: ${u}`
        }
      />
      {stale && (
        <p className="pb-1 text-[11px] text-amber-600">
          Their phone has not sent a new GPS point for a while — the app may be in the background
          or the screen locked.
        </p>
      )}
      {data?.pickup && (
        <Row
          icon={<MapPin size={14} />}
          title="Pick-up location"
          lat={data.pickup.lat}
          lng={data.pickup.lng}
          emptyText="No pin"
          message={(u) => `Badiyos ${code} — Pick-up${data.pickup?.address ? `: ${data.pickup.address}` : ""}\n${u}`}
        />
      )}
      <Row
        icon={<MapPin size={14} />}
        title={kind === "courier" ? "Drop location" : "Order location"}
        lat={data?.drop?.lat}
        lng={data?.drop?.lng}
        emptyText="No pin saved"
        message={(u) => `Badiyos ${code} — ${kind === "courier" ? "Drop" : "Order location"}${data?.drop?.address ? `: ${data.drop.address}` : ""}\n${u}`}
      />
    </div>
  );
}
