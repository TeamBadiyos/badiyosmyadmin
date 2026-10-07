import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Package, Phone, Search, Store, X, AlertTriangle, MapPin } from "lucide-react";

import {
  getStoreCategoryDetail,
  type StoreCategory,
} from "@/lib/store-categories.functions";
import { MerchantProductsModal } from "@/components/merchant-products-modal";

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-primary/10 text-primary",
  pending: "bg-amber-500/15 text-amber-700",
  query_raised: "bg-amber-500/15 text-amber-700",
  rejected: "bg-destructive/10 text-destructive",
  suspended: "bg-destructive/10 text-destructive",
  draft: "bg-muted text-muted-foreground",
};

function Pill({ s }: { s: string }) {
  const label = s === "query_raised" ? "On hold" : s.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-bold capitalize ${STATUS_STYLE[s] ?? "bg-muted text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}

export function StoreCategoryDetail({
  category,
  onClose,
}: {
  category: StoreCategory;
  onClose: () => void;
}) {
  const fetchDetail = useServerFn(getStoreCategoryDetail);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["store-categories", "detail", category.id],
    queryFn: () => fetchDetail({ data: { id: category.id } }),
  });
  const [tab, setTab] = useState<"stores" | "items">("stores");
  const [q, setQ] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openStore, setOpenStore] = useState<string | null>(null);

  const stores = data?.stores ?? [];
  const items = data?.items ?? [];
  const outOfStock = items.filter((i) => i.stock <= 0).length;
  const pending = items.filter((i) => i.approvalStatus !== "approved").length;

  const shownStores = useMemo(() => {
    const s = q.trim().toLowerCase();
    return stores.filter(
      (m) =>
        !s ||
        [m.storeName, m.ownerName, m.phone, m.city].some((v) => (v ?? "").toLowerCase().includes(s)),
    );
  }, [stores, q]);

  const shownItems = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (storeFilter === "all" || i.merchantId === storeFilter) &&
        (statusFilter === "all" ||
          (statusFilter === "out" ? i.stock <= 0 : i.approvalStatus === statusFilter)) &&
        (!s || [i.name, i.storeName, i.categoryLabel].some((v) => (v ?? "").toLowerCase().includes(s))),
    );
  }, [items, q, storeFilter, statusFilter]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-[860px] flex-col border-l border-border bg-card">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-border p-4 sm:p-5">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[16px] bg-primary/10 text-primary grid place-items-center">
            {category.photo_preview ? (
              <img src={category.photo_preview} alt={category.name} className="h-full w-full object-cover" />
            ) : (
              <Store size={26} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[18px] font-extrabold">{category.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">
              {category.slug} · {category.is_active ? "Active" : "Inactive"} · sort {category.sort_order}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Stores", stores.length],
                ["Items", items.length],
                ["Out of stock", outOfStock],
                ["Needs review", pending],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-[12px] border border-border bg-background px-3 py-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">{l}</p>
                  <p className="text-[16px] font-extrabold">{isLoading ? "…" : v}</p>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 shrink-0 rounded-[12px] border border-border grid place-items-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs + search */}
        <div className="space-y-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex gap-2">
            {(["stores", "items"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`h-9 rounded-full px-4 text-[13px] font-bold ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {t === "stores" ? `Stores (${stores.length})` : `Items (${items.length})`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tab === "stores" ? "Search store, owner, phone, city" : "Search item or store"}
                className="h-10 w-full rounded-[12px] border border-border bg-background pl-8 pr-3 text-[13px]"
              />
            </div>
            {tab === "items" && (
              <>
                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="h-10 rounded-[12px] border border-border bg-background px-2 text-[13px]"
                >
                  <option value="all">All stores</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.storeName}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-10 rounded-[12px] border border-border bg-background px-2 text-[13px]"
                >
                  <option value="all">All statuses</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="query_raised">On hold</option>
                  <option value="rejected">Rejected</option>
                  <option value="out">Out of stock</option>
                </select>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:p-5">
          {isLoading && <p className="py-10 text-center text-[13px] text-muted-foreground">Loading…</p>}
          {isError && (
            <p className="py-10 text-center text-[13px] text-destructive">
              Could not load. <button className="underline" onClick={() => refetch()}>Retry</button>
            </p>
          )}

          {!isLoading && !isError && tab === "stores" && (
            <div className="space-y-2.5">
              {shownStores.length === 0 && (
                <p className="py-10 text-center text-[13px] text-muted-foreground">No stores in this category.</p>
              )}
              {shownStores.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-border bg-background p-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-muted grid place-items-center text-muted-foreground">
                    {s.photoUrl ? <img src={s.photoUrl} alt="" className="h-full w-full object-cover" /> : <Store size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[14px] font-bold">{s.storeName}</p>
                      <Pill s={s.status} />
                      <span className={`text-[11px] font-bold ${s.acceptingOrders ? "text-primary" : "text-muted-foreground"}`}>
                        {s.acceptingOrders ? "● Taking orders" : "○ Closed"}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted-foreground">
                      {s.ownerName && <span>{s.ownerName}</span>}
                      {s.phone && (
                        <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 hover:text-foreground">
                          <Phone size={11} /> {s.phone}
                        </a>
                      )}
                      {(s.city || s.address) && (
                        <span className="inline-flex min-w-0 items-center gap-1 truncate">
                          <MapPin size={11} /> {s.city ?? s.address}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[12px] font-semibold">
                      {s.productsCount} items · {s.activeProducts} live
                    </p>
                  </div>
                  <button
                    onClick={() => setOpenStore(s.id)}
                    className="h-9 rounded-[12px] bg-primary px-3 text-[13px] font-bold text-primary-foreground"
                  >
                    View & edit items
                  </button>
                </div>
              ))}
            </div>
          )}

          {!isLoading && !isError && tab === "items" && (
            <div className="overflow-x-auto rounded-[16px] border border-border">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-left">Store</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shownItems.length === 0 && (
                    <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No items match.</td></tr>
                  )}
                  {shownItems.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[10px] bg-muted grid place-items-center text-muted-foreground">
                            {i.imageUrl ? <img src={i.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package size={15} />}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-bold">{i.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {[i.categoryLabel, i.unit].filter(Boolean).join(" · ") || "—"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{i.storeName}</td>
                      <td className="px-3 py-2 text-right font-semibold">₹{i.price.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={i.stock <= 0 ? "font-bold text-destructive" : i.stock <= i.lowStock ? "font-bold text-amber-700" : ""}>
                          {i.stock <= i.lowStock && i.stock > 0 && <AlertTriangle size={11} className="mr-1 inline" />}
                          {i.stock}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Pill s={i.approvalStatus} />
                          {(!i.isActive || i.adminHidden) && (
                            <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[11px] font-bold text-muted-foreground">
                              {i.adminHidden ? "Hidden" : "Inactive"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setOpenStore(i.merchantId)}
                          className="h-8 rounded-[10px] border border-border px-2.5 text-[12px] font-semibold"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {openStore && (
        <MerchantProductsModal
          merchantId={openStore}
          onClose={() => {
            setOpenStore(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
