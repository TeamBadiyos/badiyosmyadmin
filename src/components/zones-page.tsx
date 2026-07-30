import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LocateFixed, Map as MapIcon, Plus, X } from "lucide-react";
import {
  assignAreaPartner,
  createZone,
  listAreaPartners,
  listZones,
  type ZoneRow,
} from "@/lib/zones.functions";


type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const LATUR_CENTER = { lat: 18.4088, lng: 76.5604 };

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
    __badiyoInitMap?: () => void;
  }
}

export function ZonesPage({ role }: { role: StaffRole | null }) {
  const fetchZones = useServerFn(listZones);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["zones", "list"],
    queryFn: () => fetchZones(),
    staleTime: 30_000,
  });

  const [drawOpen, setDrawOpen] = useState(false);
  const canManage = role === "super_admin" || role === "ops_manager";
  const zones = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[14px] text-muted-foreground">
          {canManage
            ? "Manage service zones and area partner assignments."
            : "Your assigned zone."}
        </p>
        {canManage && (
          <button
            onClick={() => setDrawOpen(true)}
            className="h-[52px] px-5 rounded-[14px] bg-primary text-white text-[14px] font-bold inline-flex items-center gap-2 hover:opacity-95"
          >
            <Plus size={18} />
            Draw New Zone
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className={`grid ${canManage ? "grid-cols-[40px_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_100px_240px]" : "grid-cols-[40px_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_120px]"} gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground`}>
          <span></span>
          <span>Name</span>
          <span>City</span>
          <span>Assigned Area Partner</span>
          <span>Status</span>
          {canManage && <span className="text-right">Actions</span>}
        </div>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">
            Failed to load zones.
          </p>
        )}
        {!isLoading && !isError && zones.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            {canManage ? "No zones yet. Draw your first zone to get started." : "No zone assigned."}
          </p>
        )}

        {zones.map((z) => (
          <ZoneRowItem key={z.id} zone={z} canManage={canManage} />
        ))}
      </div>


      {drawOpen && <DrawZoneModal onClose={() => setDrawOpen(false)} />}
    </div>
  );
}

function ZoneRowItem({ zone, canManage }: { zone: ZoneRow; canManage: boolean }) {
  const queryClient = useQueryClient();
  const fetchPartners = useServerFn(listAreaPartners);
  const assign = useServerFn(assignAreaPartner);
  const [selected, setSelected] = useState<string>(zone.assignedAreaPartnerId ?? "");
  const [error, setError] = useState<string | null>(null);

  const { data: partners = [] } = useQuery({
    queryKey: ["area-partners", "active"],
    queryFn: () => fetchPartners(),
    staleTime: 60_000,
    enabled: canManage,
  });

  const mutation = useMutation({
    mutationFn: (partnerId: string | null) =>
      assign({ data: { zoneId: zone.id, partnerId } }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["zones", "list"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to assign"),
  });

  const dirty = (selected || null) !== (zone.assignedAreaPartnerId ?? null);

  return (
    <div className={`grid ${canManage ? "grid-cols-[40px_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_100px_240px]" : "grid-cols-[40px_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_120px]"} gap-4 items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px]`}>
      <div className="w-8 h-8 rounded-lg bg-primary-tint text-primary flex items-center justify-center">
        <MapIcon size={16} />
      </div>
      <span className="font-semibold text-foreground truncate">{zone.name}</span>
      <span className="text-muted-foreground truncate">{zone.city}</span>
      <span className="truncate">
        {zone.assignedAreaPartnerName ? (
          <span className="text-foreground">{zone.assignedAreaPartnerName}</span>
        ) : (
          <span className="text-muted-foreground italic">Unassigned</span>
        )}
      </span>
      <span>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${
            zone.status === "active"
              ? "bg-primary-tint text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {zone.status}
        </span>
      </span>
      {canManage && (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 w-full">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={mutation.isPending}
              className="flex-1 min-w-0 h-9 px-2 rounded-[12px] border border-border bg-card text-[12px] text-foreground disabled:opacity-60"
            >
              <option value="">
                {partners.length === 0 ? "No active partners" : "Unassigned"}
              </option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => mutation.mutate(selected ? selected : null)}
              disabled={!dirty || mutation.isPending}
              className="h-9 px-3 rounded-[12px] bg-primary text-white text-[12px] font-bold disabled:opacity-50"
            >
              {mutation.isPending ? "…" : "Save"}
            </button>
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}


function DrawZoneModal({ onClose }: { onClose: () => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapObj = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polygonRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clickListenerRef = useRef<any>(null);

  const [mapError, setMapError] = useState<string | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function handleLocate() {
    setLocateError(null);
    if (!navigator.geolocation) {
      setLocateError("Location unavailable");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const map = mapObj.current;
        if (!map) return;
        map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        map.setZoom(14);
      },
      () => {
        setLocating(false);
        setLocateError("Location unavailable");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  const queryClient = useQueryClient();
  const saveZone = useServerFn(createZone);
  const saveMutation = useMutation({
    mutationFn: (input: { name: string; city: string; boundary: { lat: number; lng: number }[] }) =>
      saveZone({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zones", "list"] });
      onClose();
    },
    onError: (err: unknown) => {
      setSaveError(err instanceof Error ? err.message : "Failed to save zone");
    },
  });

  function clearMarkers() {
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
  }

  function clearPolygon() {
    if (polygonRef.current) {
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
    clearMarkers();
    setPointCount(0);
    setFinished(false);
  }

  function finishDrawing() {
    if (!polygonRef.current) return;
    const path = polygonRef.current.getPath();
    if (path.getLength() < 3) return;
    polygonRef.current.setOptions({ editable: true });
    // Remove click listener so no more points are added
    if (clickListenerRef.current && window.google?.maps?.event) {
      window.google.maps.event.removeListener(clickListenerRef.current);
      clickListenerRef.current = null;
    }
    // Hide vertex markers since polygon is now editable
    clearMarkers();
    setFinished(true);
  }

  function extractBoundary(): { lat: number; lng: number }[] {
    if (!polygonRef.current) return [];
    const path = polygonRef.current.getPath();
    const pts: { lat: number; lng: number }[] = [];
    for (let i = 0; i < path.getLength(); i++) {
      const p = path.getAt(i);
      pts.push({ lat: p.lat(), lng: p.lng() });
    }
    return pts;
  }

  function handleSave() {
    setSaveError(null);
    const boundary = extractBoundary();
    if (boundary.length < 3) {
      setSaveError("Draw a polygon with at least 3 points.");
      return;
    }
    if (!name.trim() || !city.trim()) {
      setSaveError("Zone name and city are required.");
      return;
    }
    saveMutation.mutate({ name: name.trim(), city: city.trim(), boundary });
  }

  useEffect(() => {
    const browserKey = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
      | string
      | undefined;
    if (!browserKey) {
      setMapError("Google Maps key not configured.");
      return;
    }

    let cancelled = false;

    function initialize() {
      if (cancelled || !mapRef.current || !window.google?.maps) return;
      const g = window.google.maps;
      const map = new g.Map(mapRef.current, {
        center: LATUR_CENTER,
        zoom: 13,
        disableDefaultUI: false,
        streetViewControl: false,
        mapTypeControl: false,
        clickableIcons: false,
        zoomControl: false,
        panControl: false,
        rotateControl: false,
        scaleControl: false,
        keyboardShortcuts: false,
        fullscreenControl: true,
        fullscreenControlOptions: { position: g.ControlPosition.TOP_RIGHT },
      });
      mapObj.current = map;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clickListenerRef.current = map.addListener("click", (e: any) => {
        if (!e?.latLng) return;
        if (!polygonRef.current) {
          polygonRef.current = new g.Polygon({
            paths: [e.latLng],
            fillColor: "#00B97A",
            fillOpacity: 0.2,
            strokeColor: "#00B97A",
            strokeWeight: 2,
            clickable: false,
            editable: false,
            zIndex: 1,
            map,
          });
        } else {
          polygonRef.current.getPath().push(e.latLng);
        }
        const marker = new g.Marker({
          position: e.latLng,
          map,
          icon: {
            path: g.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: "#00B97A",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
        markersRef.current.push(marker);
        setPointCount(polygonRef.current.getPath().getLength());
      });
    }

    if (window.google?.maps) {
      initialize();
      return () => {
        cancelled = true;
        if (clickListenerRef.current && window.google?.maps?.event) {
          window.google.maps.event.removeListener(clickListenerRef.current);
        }
        clearMarkers();
        if (polygonRef.current) polygonRef.current.setMap(null);
      };
    }

    window.__badiyoInitMap = initialize;
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-badiyo-gmaps="1"]',
    );
    if (existing) {
      // Script may already be loaded but google not yet ready; poll briefly.
      const iv = window.setInterval(() => {
        if (window.google?.maps) {
          window.clearInterval(iv);
          initialize();
        }
      }, 100);
      return () => {
        cancelled = true;
        window.clearInterval(iv);
        if (clickListenerRef.current && window.google?.maps?.event) {
          window.google.maps.event.removeListener(clickListenerRef.current);
        }
        clearMarkers();
        if (polygonRef.current) polygonRef.current.setMap(null);
      };
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${browserKey}&loading=async&callback=__badiyoInitMap`;
    script.async = true;
    script.defer = true;
    script.dataset.badiyoGmaps = "1";
    script.onerror = () => setMapError("Failed to load Google Maps.");
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      if (clickListenerRef.current && window.google?.maps?.event) {
        window.google.maps.event.removeListener(clickListenerRef.current);
      }
      clearMarkers();
      if (polygonRef.current) polygonRef.current.setMap(null);
    };
  }, []);

  const saving = saveMutation.isPending;
  const hasPolygon = pointCount >= 3 && finished;
  const canFinish = pointCount >= 3 && !finished;

  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-[1100px] h-[90vh] rounded-[24px] shadow-xl flex flex-col overflow-hidden">
        <div className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-border">
          <div>
            <h2 className="text-[18px] font-bold text-foreground">Draw New Zone</h2>
            <p className="text-[12px] text-muted-foreground">
              Click on the map to add points (min 3). Press Finish Drawing to close the shape.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 relative bg-muted min-h-0">
          <div ref={mapRef} className="absolute inset-0" />
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <p className="text-[13px] text-destructive">{mapError}</p>
            </div>
          )}
          <div className="absolute top-4 left-4 bg-card/95 backdrop-blur border border-border rounded-[12px] px-3 py-2 text-[12px] font-semibold text-foreground shadow-sm">
            Points: {pointCount}
            {finished && <span className="ml-2 text-primary">• Closed</span>}
          </div>
          <div className="absolute top-4 right-4 flex gap-2">
            {canFinish && (
              <button
                onClick={finishDrawing}
                className="h-9 px-3 rounded-[12px] bg-card border border-border text-[12px] font-semibold text-foreground shadow-sm hover:bg-muted"
              >
                Finish Drawing
              </button>
            )}
            {pointCount > 0 && (
              <button
                onClick={clearPolygon}
                className="h-9 px-3 rounded-[12px] bg-card border border-border text-[12px] font-semibold text-foreground shadow-sm hover:bg-muted"
              >
                Clear
              </button>
            )}
          </div>
          <div className="absolute bottom-6 right-4 flex flex-col items-end gap-2">
            {locateError && (
              <span className="bg-card/95 backdrop-blur border border-border rounded-[10px] px-2 py-1 text-[11px] font-semibold text-destructive shadow-sm">
                {locateError}
              </span>
            )}
            <button
              onClick={handleLocate}
              disabled={locating}
              aria-label="Use my current location"
              title="Use my current location"
              className="w-10 h-10 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-foreground hover:bg-muted disabled:opacity-60"
            >
              <LocateFixed size={18} className={locating ? "animate-pulse text-primary" : ""} />
            </button>
          </div>
        </div>
        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-semibold text-foreground mb-1">
                Zone Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Latur Central"
                disabled={!hasPolygon || saving}
                className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-muted disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-foreground mb-1">
                City
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Latur"
                disabled={!hasPolygon || saving}
                className="w-full h-11 px-3 rounded-[14px] border border-border bg-card text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-muted disabled:cursor-not-allowed"
              />
            </div>
          </div>
          {saveError && (
            <p className="text-[12px] text-destructive">{saveError}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="h-10 px-4 rounded-[14px] border border-border text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasPolygon || saving}
              className="h-10 px-5 rounded-[14px] bg-primary text-white text-[13px] font-bold hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save Zone"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


