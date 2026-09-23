import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crosshair, Maximize2, MapPin, Navigation, Phone } from "lucide-react";

import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  getBookingTracking,
  getCourierTracking,
  type TrackingSnapshot,
} from "@/lib/tracking.functions";

function agoLabel(iso: string | null): string {
  if (!iso) return "no location yet";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `updated ${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `updated ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `updated ${hrs} h ago`;
}

const AGENT_ICON =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="20" fill="#00B97A" fill-opacity="0.18"/>
      <circle cx="22" cy="22" r="11" fill="#00B97A" stroke="#ffffff" stroke-width="3"/>
    </svg>`,
  );

export function LiveTrackingMap({
  kind,
  id,
}: {
  kind: "courier" | "booking";
  id: string;
}) {
  const fetchCourier = useServerFn(getCourierTracking);
  const fetchBooking = useServerFn(getBookingTracking);

  const { data, isLoading, isError, error } = useQuery<TrackingSnapshot>({
    queryKey: ["tracking", kind, id],
    queryFn: () =>
      kind === "courier"
        ? fetchCourier({ data: { orderId: id } })
        : fetchBooking({ data: { bookingId: id } }),
    refetchInterval: 5000,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const g = window.google.maps;
        mapRef.current = new g.Map(containerRef.current, {
          center: { lat: 18.4088, lng: 76.5604 },
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        setMapReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMapError(e instanceof Error ? e.message : "Map could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Paint / refresh markers whenever new tracking data arrives.
  useEffect(() => {
    if (!mapReady || !data) return;
    const g = window.google.maps;
    const map = mapRef.current;
    const bounds = new g.LatLngBounds();

    function place(
      key: string,
      pos: { lat: number; lng: number },
      title: string,
      icon?: string | Record<string, unknown>,
    ) {
      const existing = markersRef.current[key];
      if (existing) {
        existing.setPosition(pos);
        existing.setTitle(title);
      } else {
        markersRef.current[key] = new g.Marker({ map, position: pos, title, icon });
      }
      bounds.extend(pos);
    }

    if (data.pickup) {
      place(
        "pickup",
        { lat: data.pickup.lat, lng: data.pickup.lng },
        `Pick-up · ${data.pickup.address ?? ""}`,
        {
          path: g.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#16a34a",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      );
    }
    if (data.drop) {
      place(
        "drop",
        { lat: data.drop.lat, lng: data.drop.lng },
        `${data.drop.label} · ${data.drop.address ?? ""}`,
        {
          path: g.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 3,
        },
      );
    }

    const agentPos =
      data.agent && data.agent.lat != null && data.agent.lng != null
        ? { lat: data.agent.lat, lng: data.agent.lng }
        : null;
    if (agentPos) {
      place("agent", agentPos, data.agent?.name ?? "On the way", {
        url: AGENT_ICON,
        scaledSize: new g.Size(44, 44),
        anchor: new g.Point(22, 22),
      });
    } else if (markersRef.current["agent"]) {
      markersRef.current["agent"].setMap(null);
      delete markersRef.current["agent"];
    }

    // Route line: agent -> next stop -> final stop.
    const path: Array<{ lat: number; lng: number }> = [];
    if (agentPos) path.push(agentPos);
    if (data.phase === "to_pickup" && data.pickup) {
      path.push({ lat: data.pickup.lat, lng: data.pickup.lng });
      if (data.drop) path.push({ lat: data.drop.lat, lng: data.drop.lng });
    } else if (data.drop) {
      path.push({ lat: data.drop.lat, lng: data.drop.lng });
    }
    if (path.length >= 2) {
      if (lineRef.current) {
        lineRef.current.setPath(path);
      } else {
        lineRef.current = new g.Polyline({
          map,
          path,
          strokeColor: "#00B97A",
          strokeOpacity: 0.85,
          strokeWeight: 4,
        });
      }
    } else if (lineRef.current) {
      lineRef.current.setMap(null);
      lineRef.current = null;
    }

    if (follow && agentPos) {
      map.panTo(agentPos);
    } else if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 60);
    }
  }, [mapReady, data, follow]);

  const agent = data?.agent ?? null;

  return (
    <div className="rounded-[12px] border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2 min-w-0">
          <Navigation size={14} className="text-primary shrink-0" />
          <span className="text-[13px] font-bold text-foreground truncate">
            {data?.phaseLabel ?? "Live tracking"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFollow(true)}
            className={`inline-flex items-center gap-1 h-7 px-2 rounded-[8px] border text-[11px] font-semibold ${
              follow
                ? "border-primary text-primary bg-primary-tint"
                : "border-border text-muted-foreground"
            }`}
          >
            <Crosshair size={12} /> Follow rider
          </button>
          <button
            type="button"
            onClick={() => setFollow(false)}
            className={`inline-flex items-center gap-1 h-7 px-2 rounded-[8px] border text-[11px] font-semibold ${
              !follow
                ? "border-primary text-primary bg-primary-tint"
                : "border-border text-muted-foreground"
            }`}
          >
            <Maximize2 size={12} /> Full route
          </button>
        </div>
      </div>

      <div className="relative">
        <div ref={containerRef} className="h-[320px] w-full bg-muted" />
        {(isLoading || !mapReady) && !mapError && (
          <div className="absolute inset-0 grid place-items-center bg-background/70 text-[12px] text-muted-foreground">
            Loading live map…
          </div>
        )}
        {mapError && (
          <div className="absolute inset-0 grid place-items-center bg-background/90 px-4 text-center text-[12px] text-destructive">
            {mapError}
          </div>
        )}
      </div>

      <div className="px-3 py-2 space-y-1.5 text-[12px]">
        {isError && (
          <p className="text-destructive">
            Could not load tracking
            {error instanceof Error && error.message ? `: ${error.message}` : ""}.
          </p>
        )}
        {data?.pickup && (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <MapPin size={13} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>
              <span className="font-semibold text-foreground">Pick-up: </span>
              {data.pickup.address ?? "—"}
              {data.pickup.contactPhone ? ` · ${data.pickup.contactPhone}` : ""}
            </span>
          </p>
        )}
        {data?.drop && (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <MapPin size={13} className="mt-0.5 shrink-0 text-red-600" />
            <span>
              <span className="font-semibold text-foreground">{data.drop.label}: </span>
              {data.drop.address ?? "—"}
              {data.drop.contactPhone ? ` · ${data.drop.contactPhone}` : ""}
            </span>
          </p>
        )}
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <Phone size={13} className="mt-0.5 shrink-0 text-primary" />
          <span>
            {agent ? (
              <>
                <span className="font-semibold text-foreground">
                  {agent.name ?? "Assigned"}
                </span>
                {agent.phone ? ` · ${agent.phone}` : ""}
                {" · "}
                {agent.lat != null && agent.lng != null
                  ? agoLabel(agent.updatedAt)
                  : "location not shared yet"}
              </>
            ) : (
              "No one assigned yet — searching."
            )}
          </span>
        </p>
      </div>
    </div>
  );
}
