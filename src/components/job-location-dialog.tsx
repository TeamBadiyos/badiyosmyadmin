import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MapPin, Search, X } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { setBookingLocation } from "@/lib/bookings.functions";
import { PinMap } from "@/components/customer-address-editor";

const inputCls =
  "w-full h-10 px-3 rounded-[10px] border border-border bg-card text-[13px] text-foreground";
const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

export type JobLocationInitial = {
  fullAddress: string | null;
  area: string | null;
  city: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
};

export function JobLocationDialog({
  bookingId,
  initial,
  onClose,
}: {
  bookingId: string;
  initial: JobLocationInitial | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(setBookingLocation);
  const [fullAddress, setFullAddress] = useState(initial?.fullAddress ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [pincode, setPincode] = useState(initial?.pincode ?? "");
  const [lat, setLat] = useState<number | null>(initial?.lat ?? null);
  const [lng, setLng] = useState<number | null>(initial?.lng ?? null);
  const [search, setSearch] = useState("");

  const runSearch = async () => {
    if (!search.trim()) return;
    try {
      await loadGoogleMaps();
      const g = window.google.maps;
      const res = await new g.Geocoder().geocode({
        address: search,
        componentRestrictions: { country: "IN" },
      });
      const hit = res?.results?.[0];
      if (!hit) return toast.error("No location found for that search.");
      setLat(hit.geometry.location.lat());
      setLng(hit.geometry.location.lng());
    } catch {
      toast.error("Search is not available — drag the pin on the map instead.");
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          bookingId,
          fullAddress,
          area: area || null,
          city: city || null,
          pincode: pincode || null,
          lat: lat as number,
          lng: lng as number,
        },
      }),
    onSuccess: () => {
      toast.success("Job location updated everywhere");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["tracking"] });
      qc.invalidateQueries({ queryKey: ["live-tracking"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update location"),
  });

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-background/70 p-4">
      <div className="w-full max-w-[620px] max-h-[92vh] overflow-y-auto rounded-[16px] border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-foreground flex items-center gap-2">
            <MapPin size={16} className="text-primary" /> Change job location
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} className="text-muted-foreground" />
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Drag the pin to the exact gate/building. The expert's map, live tracking and the
          customer's saved address all update.
        </p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder="Search landmark / area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())}
          />
          <button
            type="button"
            onClick={runSearch}
            className="h-10 px-3 rounded-[10px] border border-border text-[13px] font-semibold inline-flex items-center gap-1"
          >
            <Search size={14} /> Find
          </button>
        </div>
        <PinMap
          lat={lat}
          lng={lng}
          onPick={(p) => {
            setLat(p.lat);
            setLng(p.lng);
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          {lat != null && lng != null
            ? `Pin: ${lat.toFixed(6)}, ${lng.toFixed(6)}`
            : "Click the map or drag the pin to set the location."}
        </p>
        <div>
          <label className={labelCls}>Full address</label>
          <textarea
            className={`${inputCls} h-20 py-2`}
            value={fullAddress}
            onChange={(e) => setFullAddress(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>Area</label>
            <input className={inputCls} value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>City</label>
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Pincode</label>
            <input
              className={inputCls}
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-[10px] border border-border text-[13px] font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={mutation.isPending || lat == null || !fullAddress.trim()}
            onClick={() => mutation.mutate()}
            className="h-10 px-4 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : "Save location"}
          </button>
        </div>
      </div>
    </div>
  );
}
