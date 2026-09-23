import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crosshair, Maximize2, MapPin, Navigation, Phone } from "lucide-react";

import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  getBookingTracking,
  getCourierTracking,
  getRoadRoute,
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

// Decodes a Google encoded polyline into lat/lng points.
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// Delivery rider on a bike, inside a pin-style badge.
const AGENT_ICON =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="24" fill="#00B97A" fill-opacity="0.16"/>
      <circle cx="26" cy="26" r="16" fill="#ffffff" stroke="#00B97A" stroke-width="3"/>
      <g transform="translate(26 26) scale(0.052) translate(-256 -256)" fill="#0f6b4f">
        <path d="M400 320a80 80 0 1 0 0 160 80 80 0 0 0 0-160zm0 120a40 40 0 1 1 0-80 40 40 0 0 1 0 80z"/>
        <path d="M112 320a80 80 0 1 0 0 160 80 80 0 0 0 0-160zm0 120a40 40 0 1 1 0-80 40 40 0 0 1 0 80z"/>
        <path d="M400 288c-9 0-17 1-25 3l-37-67h35c11 0 20-9 20-20s-9-20-20-20h-69c-7 0-14 4-17 10-4 6-4 14 0 20l14 26-63 88-46-84c-4-6-10-10-18-10h-62c-11 0-20 9-20 20s9 20 20 20h50l13 24H112c-62 0-112 50-112 112s50 112 112 112c57 0 104-42 111-97h58c7 0 13-3 17-9l84-117 16 29c-27 20-45 53-45 90 0 62 50 112 112 112s112-50 112-112-50-112-112-112zM112 472c-40 0-72-32-72-72s32-72 72-72 72 32 72 72-32 72-72 72zm288 0c-40 0-72-32-72-72s32-72 72-72 72 32 72 72-32 72-72 72z"/>
      </g>
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
  const fetchRoute = useServerFn(getRoadRoute);

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

  const agentPos = useMemo(
    () =>
      data?.agent && data.agent.lat != null && data.agent.lng != null
        ? { lat: data.agent.lat, lng: data.agent.lng }
        : null,
    [data],
  );

  // Stops for the road route: agent -> next stop -> final stop.
  const stops = useMemo(() => {
    if (!data) return [] as Array<{ lat: number; lng: number }>;
    const list: Array<{ lat: number; lng: number }> = [];
    if (agentPos) list.push(agentPos);
    if (data.phase === "to_pickup" && data.pickup) {
      list.push({ lat: data.pickup.lat, lng: data.pickup.lng });
      if (data.drop) list.push({ lat: data.drop.lat, lng: data.drop.lng });
    } else if (data.drop) {
      list.push({ lat: data.drop.lat, lng: data.drop.lng });
    } else if (data.pickup) {
      list.push({ lat: data.pickup.lat, lng: data.pickup.lng });
    }
    return list;
  }, [data, agentPos]);

  // Rounded key so the 5s poll only re-asks for a route when a point really moved.
  const stopsKey = useMemo(
    () => stops.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|"),
    [stops],
  );

  const routeQuery = useQuery({
    queryKey: ["tracking", "route", stopsKey],
    queryFn: () => fetchRoute({ data: { stops } }),
    enabled: stops.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const routePath = useMemo(() => {
    const encoded = routeQuery.data?.polyline;
    if (!encoded) return null;
    const pts = decodePolyline(encoded);
    return pts.length > 1 ? pts : null;
  }, [routeQuery.data]);

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
          clickableIcons: false,
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
      icon: string | Record<string, unknown>,
      zIndex: number,
    ) {
      const existing = markersRef.current[key];
      if (existing) {
        existing.setPosition(pos);
        existing.setTitle(title);
        existing.setIcon(icon);
        existing.setZIndex(zIndex);
      } else {
        markersRef.current[key] = new g.Marker({
          map,
          position: pos,
          title,
          icon,
          zIndex,
        });
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
        10,
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
        11,
      );
    }

    if (agentPos) {
      // Highest zIndex so the rider is never hidden under the pick-up / drop pins.
      place(
        "agent",
        agentPos,
        data.agent?.name ?? "On the way",
        {
          url: AGENT_ICON,
          scaledSize: new g.Size(46, 46),
          anchor: new g.Point(23, 23),
        },
        999,
      );
    } else if (markersRef.current["agent"]) {
      markersRef.current["agent"].setMap(null);
      delete markersRef.current["agent"];
    }

    // Prefer the real road route; fall back to a connector line until it loads.
    const path = routePath ?? (stops.length >= 2 ? stops : null);
    if (path) {
      if (lineRef.current) {
        lineRef.current.setPath(path);
        lineRef.current.setMap(map);
      } else {
        lineRef.current = new g.Polyline({
          map,
          path,
          strokeColor: "#00B97A",
          strokeOpacity: 0.9,
          strokeWeight: 5,
          zIndex: 5,
        });
      }
      path.forEach((p) => bounds.extend(p));
    } else if (lineRef.current) {
      lineRef.current.setMap(null);
      lineRef.current = null;
    }

    if (follow && agentPos) {
      map.panTo(agentPos);
    } else if (!bounds.isEmpty()) {
      // Generous padding keeps pins clear of the map edges and the footer card.
      map.fitBounds(bounds, { top: 56, right: 48, bottom: 72, left: 48 });
    }
  }, [mapReady, data, follow, agentPos, stops, routePath]);

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
        {routeQuery.data?.distanceMeters != null && (
          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">Route: </span>
            {(routeQuery.data.distanceMeters / 1000).toFixed(1)} km
            {routeQuery.data.durationSeconds != null
              ? ` · about ${Math.max(1, Math.round(routeQuery.data.durationSeconds / 60))} min`
              : ""}
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
