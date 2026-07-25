import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Map as MapIcon, Plus, X } from "lucide-react";
import { createZone, listZones, type ZoneRow } from "@/lib/zones.functions";

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
        <div className="grid grid-cols-[40px_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_120px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span></span>
          <span>Name</span>
          <span>City</span>
          <span>Assigned Area Partner</span>
          <span>Status</span>
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
          <ZoneRowItem key={z.id} zone={z} />
        ))}
      </div>

      {drawOpen && <DrawZoneModal onClose={() => setDrawOpen(false)} />}
    </div>
  );
}

function ZoneRowItem({ zone }: { zone: ZoneRow }) {
  return (
    <div className="grid grid-cols-[40px_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,2fr)_120px] gap-4 items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px]">
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
    </div>
  );
}

function DrawZoneModal({ onClose }: { onClose: () => void }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState<string | null>(null);

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
      new window.google.maps.Map(mapRef.current, {
        center: LATUR_CENTER,
        zoom: 11,
        disableDefaultUI: false,
        streetViewControl: false,
        mapTypeControl: false,
      });
    }

    if (window.google?.maps) {
      initialize();
      return () => {
        cancelled = true;
      };
    }

    window.__badiyoInitMap = initialize;
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-badiyo-gmaps="1"]',
    );
    if (existing) {
      // Another instance is loading; wait for the callback.
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${browserKey}&loading=async&callback=__badiyoInitMap&libraries=drawing`;
    script.async = true;
    script.defer = true;
    script.dataset.badiyoGmaps = "1";
    script.onerror = () => setMapError("Failed to load Google Maps.");
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 flex items-center justify-center p-4">
      <div className="bg-card w-full max-w-[1100px] h-[85vh] rounded-[24px] shadow-xl flex flex-col overflow-hidden">
        <div className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-border">
          <div>
            <h2 className="text-[18px] font-bold text-foreground">Draw New Zone</h2>
            <p className="text-[12px] text-muted-foreground">
              Drawing tools coming next — map preview centered on Latur.
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
        <div className="flex-1 relative bg-muted">
          <div ref={mapRef} className="absolute inset-0" />
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-destructive">{mapError}</p>
            </div>
          )}
        </div>
        <div className="h-16 shrink-0 flex items-center justify-end gap-3 px-6 border-t border-border">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-[14px] border border-border text-[13px] font-semibold text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled
            className="h-10 px-4 rounded-[14px] bg-primary text-white text-[13px] font-bold opacity-50 cursor-not-allowed"
          >
            Save Zone
          </button>
        </div>
      </div>
    </div>
  );
}
