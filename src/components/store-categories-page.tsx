import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Apple,
  Baby,
  Beef,
  Bike,
  Book,
  Cake,
  Car,
  Carrot,
  Cat,
  Coffee,
  Croissant,
  Drill,
  Flower2,
  Gem,
  Gift,
  Glasses,
  Hammer,
  HeartPulse,
  Laptop,
  Milk,
  Package,
  Paintbrush,
  Pencil,
  Pill,
  Plus,
  RefreshCw,
  Scissors,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Store,
  Utensils,
  Watch,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import {
  listStoreCategories,
  listStoreSegments,
  setStoreCategoryActive,
  upsertStoreCategory,
  type StoreCategory,
} from "@/lib/store-categories.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const ICONS: Record<string, LucideIcon> = {
  ShoppingBasket,
  ShoppingCart,
  Store,
  Package,
  Apple,
  Carrot,
  Milk,
  Cake,
  Croissant,
  Coffee,
  Beef,
  Utensils,
  Pill,
  HeartPulse,
  Book,
  Pencil,
  Smartphone,
  Laptop,
  Zap,
  Hammer,
  Wrench,
  Drill,
  Shirt,
  Watch,
  Glasses,
  Gem,
  Gift,
  Flower2,
  Sofa,
  Scissors,
  Paintbrush,
  Sparkles,
  Baby,
  Cat,
  Car,
  Bike,
};

const ICON_NAMES = Object.keys(ICONS);

function CategoryIcon({
  name,
  size = 18,
}: {
  name: string | null;
  size?: number;
}) {
  const Icon = (name && ICONS[name]) || Store;
  return <Icon size={size} />;
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "—";
  }
}

export function StoreCategoriesPage({ role }: { role: StaffRole | null }) {
  const queryClient = useQueryClient();
  const fetchRows = useServerFn(listStoreCategories);
  const fetchSegments = useServerFn(listStoreSegments);
  const saveFn = useServerFn(upsertStoreCategory);
  const toggleFn = useServerFn(setStoreCategoryActive);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["store-categories", "list"],
    queryFn: () => fetchRows(),
    staleTime: 10_000,
  });

  const { data: segments = [] } = useQuery({
    queryKey: ["store-categories", "segments"],
    queryFn: () => fetchSegments(),
    staleTime: 60_000,
  });

  const rows = data?.categories ?? [];
  const canManage = (data?.role ?? role) === "super_admin";

  const [editing, setEditing] = useState<
    { category: StoreCategory | null } | null
  >(null);
  const [confirmOff, setConfirmOff] = useState<StoreCategory | null>(null);

  const toggle = useMutation({
    mutationFn: (p: { id: string; is_active: boolean }) =>
      toggleFn({ data: p }),
    onSuccess: (_r, p) => {
      toast.success(p.is_active ? "Category activated" : "Category deactivated");
      queryClient.invalidateQueries({ queryKey: ["store-categories"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  function onToggle(cat: StoreCategory) {
    if (cat.is_active && cat.merchants_count > 0) {
      setConfirmOff(cat);
      return;
    }
    toggle.mutate({ id: cat.id, is_active: !cat.is_active });
  }

  const defaultSegmentId = useMemo(() => {
    const store = segments.find((s) => s.slug === "store");
    return store?.id ?? segments[0]?.id ?? "";
  }, [segments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Categories that merchants pick while registering their store. Inactive
          categories disappear from registration and from customers.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-2"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />{" "}
            Refresh
          </button>
          {canManage && (
            <button
              onClick={() => setEditing({ category: null })}
              className="h-10 px-4 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-2"
            >
              <Plus size={15} /> Store Category
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <p className="text-[13px] text-muted-foreground py-10 text-center">
          Loading…
        </p>
      )}
      {isError && (
        <p className="text-[13px] text-destructive py-10 text-center">
          Failed to load store categories.
        </p>
      )}

      {!isLoading && !isError && (
        <div className="rounded-[18px] border border-border bg-card overflow-hidden">
          <div className="hidden md:grid grid-cols-[60px_1fr_140px_120px_110px_90px] gap-3 px-4 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <span>Icon</span>
            <span>Name</span>
            <span>Merchants</span>
            <span>Active</span>
            <span>Sort order</span>
            <span className="text-right">Edit</span>
          </div>

          {rows.length === 0 && (
            <p className="text-[13px] text-muted-foreground py-10 text-center">
              No store categories yet.
            </p>
          )}

          {rows.map((cat) => (
            <div
              key={cat.id}
              className="grid md:grid-cols-[60px_1fr_140px_120px_110px_90px] gap-3 px-4 py-3 border-b border-border last:border-0 items-center"
            >
              <div className="h-10 w-10 rounded-[14px] bg-primary/10 text-primary grid place-items-center">
                <CategoryIcon name={cat.icon} />
              </div>

              <div className="min-w-0">
                <p className="text-[14px] font-bold truncate">{cat.name}</p>
                <p className="text-[12px] text-muted-foreground truncate">
                  {cat.slug} · updated {fmt(cat.updated_at)}
                </p>
              </div>

              <div>
                <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-muted text-[12px] font-semibold">
                  {cat.merchants_count} store
                  {cat.merchants_count === 1 ? "" : "s"}
                </span>
              </div>

              <div>
                <button
                  disabled={!canManage || toggle.isPending}
                  onClick={() => onToggle(cat)}
                  className={`h-7 w-12 rounded-full transition-colors relative disabled:opacity-50 ${
                    cat.is_active ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                  aria-label={cat.is_active ? "Deactivate" : "Activate"}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      cat.is_active ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>

              <div className="text-[13px] font-semibold">{cat.sort_order}</div>

              <div className="md:text-right">
                <button
                  disabled={!canManage}
                  onClick={() => setEditing({ category: cat })}
                  className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <Pencil size={13} /> Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CategoryDrawer
          category={editing.category}
          defaultSegmentId={defaultSegmentId}
          segments={segments}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await saveFn({ data: payload });
            toast.success(
              payload.id ? "Store category updated" : "Store category created",
            );
            queryClient.invalidateQueries({ queryKey: ["store-categories"] });
            setEditing(null);
          }}
        />
      )}

      {confirmOff && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4">
          <div className="w-full max-w-[420px] rounded-[18px] bg-card border border-border p-5 space-y-4">
            <p className="text-[16px] font-bold">Deactivate {confirmOff.name}?</p>
            <p className="text-[13px] text-muted-foreground">
              {confirmOff.merchants_count} store
              {confirmOff.merchants_count === 1 ? " is" : "s are"} linked. They
              will be hidden from customers until moved.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOff(null)}
                className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  toggle.mutate({ id: confirmOff.id, is_active: false });
                  setConfirmOff(null);
                }}
                className="h-10 px-4 rounded-[12px] bg-destructive text-white text-[13px] font-bold"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryDrawer({
  category,
  segments,
  defaultSegmentId,
  onClose,
  onSave,
}: {
  category: StoreCategory | null;
  segments: Array<{ id: string; name: string; slug: string }>;
  defaultSegmentId: string;
  onClose: () => void;
  onSave: (payload: {
    id?: string | null;
    segment_id: string;
    name: string;
    icon: string | null;
    sort_order: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [sortOrder, setSortOrder] = useState<string>(
    String(category?.sort_order ?? 0),
  );
  const [segmentId, setSegmentId] = useState(
    category?.segment_id ?? defaultSegmentId,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!segmentId && defaultSegmentId) setSegmentId(defaultSegmentId);
  }, [defaultSegmentId, segmentId]);

  async function submit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!segmentId) {
      toast.error("Segment is required");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: category?.id ?? null,
        segment_id: segmentId,
        name: name.trim(),
        icon,
        sort_order: Number(sortOrder) || 0,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <div className="w-full max-w-[460px] h-full bg-card border-l border-border overflow-y-auto p-5 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-extrabold">
            {category ? "Edit store category" : "New store category"}
          </p>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-[12px] border border-border grid place-items-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kirana & Grocery"
            className="w-full h-11 px-3 rounded-[14px] border border-border bg-background text-[14px]"
          />
        </div>

        {segments.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
              Segment
            </label>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="w-full h-11 px-3 rounded-[14px] border border-border bg-background text-[14px]"
            >
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            Sort order
          </label>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-full h-11 px-3 rounded-[14px] border border-border bg-background text-[14px]"
          />
          <p className="text-[12px] text-muted-foreground">
            Lower numbers appear first during merchant registration.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
            Icon
          </label>
          <div className="grid grid-cols-8 gap-2">
            {ICON_NAMES.map((n) => {
              const Icon = ICONS[n]!;
              const active = icon === n;
              return (
                <button
                  key={n}
                  type="button"
                  title={n}
                  onClick={() => setIcon(active ? null : n)}
                  className={`h-10 rounded-[12px] grid place-items-center border transition-colors ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[14px] border border-border text-[13px] font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={submit}
            className="h-11 px-5 rounded-[14px] bg-primary text-white text-[13px] font-bold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
