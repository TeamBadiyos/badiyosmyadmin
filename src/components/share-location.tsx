import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, MapPin, MessageCircle, Bike } from "lucide-react";
import { toast } from "sonner";

import { getBookingTracking, getCourierTracking } from "@/lib/tracking.functions";

function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
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
}: {
  icon: React.ReactNode;
  title: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  message: (url: string) => string;
  emptyText: string;
}) {
  const ok = lat != null && lng != null;
  const url = ok ? mapsLink(lat!, lng!) : "";
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-primary shrink-0">{icon}</span>
      <span className="text-[12px] font-semibold text-foreground flex-1 min-w-0 truncate">
        {title}
        {!ok && <span className="ml-1 font-normal text-muted-foreground">· {emptyText}</span>}
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
  const fetchCourier = useServerFn(getCourierTracking);
  const fetchBooking = useServerFn(getBookingTracking);
  const { data } = useQuery({
    queryKey: ["share-location", kind, id],
    queryFn: () =>
      kind === "courier"
        ? fetchCourier({ data: { orderId: id } })
        : fetchBooking({ data: { bookingId: id } }),
    refetchInterval: 15_000,
  });

  const agent = data?.agent;
  const code = data?.code ?? "";

  return (
    <div className="mb-3 rounded-[14px] border border-border p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
        Share location
      </p>
      <Row
        icon={<Bike size={14} />}
        title={`${kind === "courier" ? "Rider" : "Expert"} live location${agent?.name ? ` (${agent.name})` : ""}`}
        lat={agent?.lat}
        lng={agent?.lng}
        emptyText={agent ? "Waiting for GPS" : "Not assigned yet"}
        message={(u) =>
          `Badiyos ${code} — ${agent?.name ?? "Partner"} live location${agent?.phone ? ` (${agent.phone})` : ""}: ${u}`
        }
      />
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
