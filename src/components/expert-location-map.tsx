import { useEffect, useRef, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export function ExpertLocationMap({
  lat,
  lng,
  updatedAt,
}: {
  lat: number | null;
  lng: number | null;
  updatedAt: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const has = lat != null && lng != null;

  useEffect(() => {
    if (!has) return;
    let dead = false;
    loadGoogleMaps()
      .then(() => {
        if (dead || !ref.current) return;
        const g = window.google.maps;
        const pos = { lat: lat as number, lng: lng as number };
        if (!mapRef.current) {
          mapRef.current = new g.Map(ref.current, {
            center: pos,
            zoom: 16,
            clickableIcons: false,
            disableDefaultUI: true,
            zoomControl: true,
          });
          markerRef.current = new g.Marker({ map: mapRef.current, position: pos });
        } else {
          mapRef.current.setCenter(pos);
          markerRef.current?.setPosition(pos);
        }
      })
      .catch(() => setErr("Map could not load."));
    return () => {
      dead = true;
    };
  }, [has, lat, lng]);

  return (
    <section className="bg-background border border-border rounded-[18px] p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <MapPin size={13} /> Current location
        </h3>
        {has && (
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
            className="h-8 px-3 rounded-[10px] border border-border bg-card text-[12px] font-semibold inline-flex items-center gap-1"
          >
            Open in Google Maps <ExternalLink size={12} />
          </a>
        )}
      </div>
      {!has ? (
        <p className="text-[13px] text-muted-foreground">No live location received from the Expert app yet.</p>
      ) : (
        <>
          {err ? (
            <p className="text-[13px] text-destructive">{err}</p>
          ) : (
            <div ref={ref} className="w-full h-[260px] rounded-[12px] overflow-hidden bg-muted" />
          )}
          <p className="text-[11px] text-muted-foreground mt-2 font-mono">
            {(lat as number).toFixed(5)}, {(lng as number).toFixed(5)}
            {updatedAt &&
              ` · ${new Date(updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}`}
          </p>
        </>
      )}
    </section>
  );
}
