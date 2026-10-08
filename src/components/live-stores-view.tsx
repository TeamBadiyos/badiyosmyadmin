import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, Phone, Search, Store, Package, ArrowLeft, Navigation, MessageCircle, Clock } from "lucide-react";
import { listLiveStores, type LiveStore, type LiveStoreItem } from "@/lib/merchants.functions";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function Img({ src, fallback, alt, className }: { src: string | null; fallback?: string | null; alt: string; className: string }) {
  const [s, setS] = useState(src);
  const [failed, setFailed] = useState(false);
  if (!s || failed)
    return (
      <div className={`${className} bg-muted flex items-center justify-center text-muted-foreground`}>
        <Package size={22} />
      </div>
    );
  return (
    <img
      src={s}
      alt={alt}
      loading="lazy"
      className={`${className} object-cover`}
      onError={() => (fallback && s !== fallback ? setS(fallback) : setFailed(true))}
    />
  );
}

function StatusPill({ s }: { s: LiveStore }) {
  const open = s.acceptingOrders && s.storeEnabled;
  return (
    <span
      className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${
        open ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {open ? "Open · taking orders" : "Closed now"}
    </span>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function t12(t: string | null) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function istDay() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getDay();
}
function todayLabel(s: LiveStore) {
  const h = s.hours.find((x) => x.day === istDay());
  if (!h) return "Timing not set";
  return h.closed ? "Closed today" : `Today ${t12(h.open)} – ${t12(h.close)}`;
}

function mapUrl(s: LiveStore) {
  if (s.latitude != null && s.longitude != null)
    return `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`;
  const q = [s.address, s.city, s.pincode].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export function LiveStoresView() {
  const fetchStores = useServerFn(listLiveStores);
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["merchants", "live-stores"],
    queryFn: () => fetchStores(),
    staleTime: 15_000,
  });
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t
      ? data.filter((s) => `${s.storeName} ${s.city ?? ""} ${s.categoryName ?? ""}`.toLowerCase().includes(t))
      : data;
  }, [data, q]);

  const open = data.find((s) => s.id === openId);
  if (open) return <StoreDetail store={open} onBack={() => setOpenId(null)} />;

  return (
    <div className="space-y-4">
      <div className="relative max-w-[320px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search store, city, category"
          className="w-full h-10 pl-9 pr-3 rounded-[12px] border border-border bg-card text-[14px]"
        />
      </div>
      {isLoading && <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>}
      {isError && <p className="text-[13px] text-destructive py-10 text-center">Could not load stores.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-[13px] text-muted-foreground py-10 text-center">No live stores.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((s) => (
          <button
            key={s.id}
            onClick={() => setOpenId(s.id)}
            className="text-left bg-card border border-border rounded-[18px] overflow-hidden hover:border-primary transition-colors"
          >
            <Img src={s.photoUrl} alt={s.storeName} className="w-full h-40" />
            <div className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[16px] font-bold text-foreground truncate">{s.storeName}</h3>
                <StatusPill s={s} />
              </div>
              <p className="text-[12px] text-muted-foreground truncate">
                {[s.categoryName, s.segmentName].filter(Boolean).join(" · ") || "—"}
              </p>
              <p className="text-[13px] text-muted-foreground flex items-center gap-1 truncate">
                <MapPin size={13} className="shrink-0" /> {[s.city, s.pincode].filter(Boolean).join(" · ") || "Location not set"}
              </p>
              <p className="text-[13px] text-muted-foreground flex items-center gap-1">
                <Clock size={13} className="shrink-0" /> {todayLabel(s)}
              </p>
              <p className="text-[13px] font-semibold text-foreground flex items-center gap-1">
                <Package size={13} /> {s.items.length} live item{s.items.length === 1 ? "" : "s"}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StoreDetail({ store: s, onBack }: { store: LiveStore; onBack: () => void }) {
  const [q, setQ] = useState("");
  const url = mapUrl(s);
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m = new Map<string, LiveStoreItem[]>();
    for (const i of s.items) {
      if (t && !i.name.toLowerCase().includes(t)) continue;
      const k = i.category || "Other items";
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()];
  }, [s.items, q]);
  const outOfStock = s.items.filter((i) => !i.inStock).length;
  const phone10 = s.phone.replace(/\D/g, "").slice(-10);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="h-9 px-3 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-1">
        <ArrowLeft size={14} /> All live stores
      </button>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <Img src={s.photoUrl} alt={s.storeName} className="w-full h-48 sm:h-64" />
        <div className="p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-[22px] font-bold text-foreground flex items-center gap-2">
                <Store size={20} className="text-primary shrink-0" /> {s.storeName}
              </h2>
              <p className="text-[13px] text-muted-foreground mt-1">
                {[s.categoryName, s.segmentName].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <StatusPill s={s} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
            <Info label="Owner">{s.ownerName || "—"}</Info>
            <Info label="Phone"><span className="font-mono">{s.phone}</span></Info>
            <Info label="Delivery">{s.deliveryEnabled ? "Delivery available" : "Pickup only"}</Info>
            <Info label="Items">
              {s.items.length} live{outOfStock ? ` · ${outOfStock} out of stock` : ""}
            </Info>
            <Info label="Zone">{s.zoneName || "—"}</Info>
            <Info label="Fulfilment">
              {s.fulfillmentMode === "PLATFORM" ? "Badiyos rider" : s.fulfillmentMode === "SELF" ? "Store delivers" : s.fulfillmentMode || "—"}
            </Info>
            <Info label="Delivery fee paid by">
              {s.deliveryFeePayer === "CUSTOMER" ? "Customer" : s.deliveryFeePayer === "MERCHANT" ? "Store" : s.deliveryFeePayer || "—"}
            </Info>
            <Info label="Commission">{s.commissionPct}% per order</Info>
          </div>

          <div className="rounded-[14px] border border-border p-3">
            <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
              <Clock size={13} /> Store timings
            </p>
            {s.hours.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Timing not set by store.</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const h = s.hours.find((x) => x.day === d);
                  const today = d === istDay();
                  return (
                    <div key={d} className={`flex justify-between gap-2 rounded-[10px] px-2 py-1 ${today ? "bg-primary/10 font-semibold" : ""}`}>
                      <span>{DAYS[d]}</span>
                      <span className={!h || h.closed ? "text-destructive" : "text-foreground"}>
                        {!h ? "Not set" : h.closed ? "Closed" : `${t12(h.open)} – ${t12(h.close)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-[14px] border border-border p-3 flex items-start justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-foreground flex items-start gap-2 min-w-0">
              <MapPin size={15} className="text-primary shrink-0 mt-0.5" />
              <span>{[s.address, s.city, s.state, s.pincode].filter(Boolean).join(", ") || "Address not set"}</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-1">
                  <Navigation size={14} /> Open map
                </a>
              )}
              <a href={`tel:${s.phone}`} className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-bold inline-flex items-center gap-1">
                <Phone size={14} /> Call
              </a>
              {phone10.length === 10 && (
                <a href={`https://wa.me/91${phone10}`} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-bold inline-flex items-center gap-1">
                  <MessageCircle size={14} /> WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-[16px] font-bold text-foreground">Items in store</h3>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search items"
          className="h-10 px-3 rounded-[12px] border border-border bg-card text-[14px] w-full sm:w-[260px]"
        />
      </div>
      {groups.length === 0 && <p className="text-[13px] text-muted-foreground py-6 text-center">No live items.</p>}
      {groups.map(([cat, items]) => (
        <div key={cat} className="space-y-3">
          <p className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
            {cat} · {items.length}
          </p>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {items.map((i) => (
              <div key={i.id} className="bg-card border border-border rounded-[14px] overflow-hidden">
                <Img src={i.thumbUrl} fallback={i.imageUrl} alt={i.name} className="w-full aspect-square" />
                <div className="p-3 space-y-1">
                  <p className="text-[13px] font-semibold text-foreground line-clamp-2">{i.name}</p>
                  <p className="text-[12px] text-muted-foreground">{i.unit || "—"}</p>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[14px] font-bold text-foreground">{inr(i.price)}</span>
                    <span className={`text-[10px] font-bold uppercase ${i.inStock ? "text-primary" : "text-destructive"}`}>
                      {i.inStock ? `${i.stock} in stock` : "Out of stock"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] bg-muted/40 px-3 py-2 min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-foreground mt-0.5 truncate">{children}</p>
    </div>
  );
}
