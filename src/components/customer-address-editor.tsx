import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MapPin, Search, X } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  deleteCustomerAddress,
  saveCustomerAddress,
  type CustomerProfile,
} from "@/lib/users.functions";

export type AddressRow = CustomerProfile["addresses"][number];

const DEFAULT_CENTER = { lat: 18.4088, lng: 76.5604 }; // Latur

const inputCls =
  "w-full h-10 px-3 rounded-[10px] border border-border bg-card text-[13px] text-foreground";
const labelCls = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

/** Draggable map pin; reports the picked point up. */
export function PinMap({
  lat,
  lng,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (p: { lat: number; lng: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    loadGoogleMaps()
      .then(() => {
        if (dead || !ref.current || mapRef.current) return;
        const g = window.google.maps;
        const center = lat != null && lng != null ? { lat, lng } : DEFAULT_CENTER;
        const map = new g.Map(ref.current, {
          center,
          zoom: lat != null ? 17 : 12,
          clickableIcons: false,
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: true,
        });
        const marker = new g.Marker({ map, position: center, draggable: true });
        marker.addListener("dragend", () => {
          const p = marker.getPosition();
          onPick({ lat: p.lat(), lng: p.lng() });
        });
        map.addListener("click", (e: { latLng: { lat: () => number; lng: () => number } }) => {
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          marker.setPosition(p);
          onPick(p);
        });
        mapRef.current = map;
        markerRef.current = marker;
      })
      .catch(() => setErr("Map could not load."));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the marker in sync when coordinates change from search / manual entry
  useEffect(() => {
    if (!markerRef.current || lat == null || lng == null) return;
    const pos = { lat, lng };
    markerRef.current.setPosition(pos);
    mapRef.current?.panTo(pos);
  }, [lat, lng]);

  if (err) return <p className="text-[12px] text-destructive">{err}</p>;
  return <div ref={ref} className="h-[280px] w-full rounded-[12px] border border-border" />;
}

export function CustomerAddressModal({
  userId,
  address,
  onClose,
}: {
  userId: string;
  address: AddressRow | null;
  onClose: () => void;
}) {
  const save = useServerFn(saveCustomerAddress);
  const qc = useQueryClient();

  const [label, setLabel] = useState(address?.label ?? "Home");
  const [fullAddress, setFullAddress] = useState(address?.full_address ?? "");
  const [area, setArea] = useState(address?.area ?? "");
  const [city, setCity] = useState(address?.city ?? "");
  const [pincode, setPincode] = useState(address?.pincode ?? "");
  const [lat, setLat] = useState<number | null>(address?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(address?.longitude ?? null);
  const [isDefault, setIsDefault] = useState(Boolean(address?.is_default));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  /** Uses the loaded Maps geocoder; if the key does not allow it we just keep manual entry. */
  const runGeocode = async (q: string) => {
    try {
      await loadGoogleMaps();
      const g = window.google.maps;
      const geocoder = new g.Geocoder();
      const res = await geocoder.geocode({ address: q, componentRestrictions: { country: "IN" } });
      const hit = res?.results?.[0];
      if (!hit) {
        toast.error("No location found for that search.");
        return;
      }
      setLat(hit.geometry.location.lat());
      setLng(hit.geometry.location.lng());
      if (!fullAddress.trim()) setFullAddress(hit.formatted_address ?? q);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comps: any[] = hit.address_components ?? [];
      const pick = (t: string) => comps.find((c) => c.types?.includes(t))?.long_name ?? "";
      if (!city) setCity(pick("locality") || pick("administrative_area_level_3"));
      if (!area) setArea(pick("sublocality_level_1") || pick("sublocality") || pick("neighborhood"));
      if (!pincode) setPincode(pick("postal_code"));
      toast.success("Location found — drag the pin for the exact spot.");
    } catch {
      toast.error("Search is unavailable. Drag the pin on the map instead.");
    }
  };

  const submit = async () => {
    if (!fullAddress.trim()) {
      toast.error("Full address is required.");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          userId,
          addressId: address?.id ?? null,
          label: label.trim() || null,
          fullAddress: fullAddress.trim(),
          area: area.trim() || null,
          city: city.trim() || null,
          pincode: pincode.trim() || null,
          latitude: lat,
          longitude: lng,
          isDefault,
        },
      });
      toast.success(address ? "Address updated." : "Address added.");
      qc.invalidateQueries({ queryKey: ["customers", "profile", userId] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save this address.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-3xl my-6">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-[16px] font-bold text-foreground">
            {address ? "Edit address & location" : "Add address"}
          </h3>
          <button
            onClick={onClose}
            className="h-9 w-9 inline-flex items-center justify-center rounded-[12px] border border-border hover:bg-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim()) {
                  e.preventDefault();
                  void runGeocode(search.trim());
                }
              }}
              placeholder="Search colony, landmark or full address"
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => search.trim() && void runGeocode(search.trim())}
              className="h-10 px-4 rounded-[10px] border border-border text-[13px] font-semibold inline-flex items-center gap-2 hover:bg-muted"
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
          <p className="text-[12px] text-muted-foreground">
            Drag the pin or tap on the map to set the exact doorstep.{" "}
            {lat != null && lng != null ? (
              <span className="text-foreground font-semibold">
                {lat.toFixed(6)}, {lng.toFixed(6)}
              </span>
            ) : (
              "No pin set yet."
            )}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="Home / Work" />
            </label>
            <label className={labelCls}>
              City
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
            </label>
          </div>

          <label className={labelCls}>
            Full address
            <textarea
              value={fullAddress}
              onChange={(e) => setFullAddress(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-[10px] border border-border bg-card text-[13px] text-foreground"
              placeholder="Flat / house no, building, street"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Area / landmark
              <input value={area} onChange={(e) => setArea(e.target.value)} className={inputCls} />
            </label>
            <label className={labelCls}>
              Pincode
              <input
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={inputCls}
                inputMode="numeric"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Set as default address
          </label>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-border">
          <button onClick={onClose} className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="h-10 px-5 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50 inline-flex items-center gap-2"
          >
            <MapPin size={14} /> {busy ? "Saving…" : "Save address"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useDeleteAddress(userId: string) {
  const call = useServerFn(deleteCustomerAddress);
  const qc = useQueryClient();
  return async (addressId: string) => {
    if (!window.confirm("Delete this address?")) return;
    try {
      await call({ data: { addressId } });
      toast.success("Address deleted.");
      qc.invalidateQueries({ queryKey: ["customers", "profile", userId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete this address.");
    }
  };
}
