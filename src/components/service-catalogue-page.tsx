import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Check, X, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listServicePrices,
  listServiceCategories,
  updateServicePrice,
  createServicePriceRow,
  deleteServicePriceRow,
  type ServicePriceRow,
} from "@/lib/service-catalogue.functions";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function ServiceCataloguePage() {
  const fetchRows = useServerFn(listServicePrices);
  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ["service-catalogue", "list"],
    queryFn: () => fetchRows(),
    staleTime: 15_000,
  });

  const fetchCategories = useServerFn(listServiceCategories);
  const { data: categories = [] } = useQuery({
    queryKey: ["service-catalogue", "categories"],
    queryFn: () => fetchCategories(),
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();
  const removeRow = useServerFn(deleteServicePriceRow);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeRow({ data: { id } }),
    onSuccess: () => {
      toast.success("Row permanently deleted");
      queryClient.invalidateQueries({ queryKey: ["service-catalogue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = data.find((r) => r.id === editingId) ?? null;
  const rows =
    categoryFilter === "all"
      ? data
      : data.filter((r) => r.service_category_id === categoryFilter);
  const defaultCategoryId =
    categories.find((c) => c.slug === "home-cleaning")?.id ?? categories[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted-foreground">
          Customer prices and payout splits per service duration, per service category.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] font-semibold text-foreground"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground font-bold text-[13px] inline-flex items-center gap-1.5"
          >
            <Plus size={16} /> New row
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_140px_120px_100px_140px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Duration</span>
          <span className="text-right">Customer Price</span>
          <span className="text-right">Expert Payout</span>
          <span className="text-right">Partner Commission</span>
          <span className="text-right">HQ Share</span>
          <span>Status</span>
          <span></span>
        </div>

        {isLoading && <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">
            {(error as Error)?.message ?? "Failed to load pricing."}
          </p>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No pricing rows yet.</p>
        )}

        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_140px_120px_100px_140px] gap-4 items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px]"
          >
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{r.duration_label}</p>
              <p className="text-[12px] text-muted-foreground">
                {r.duration_minutes} min{r.subtitle ? ` · ${r.subtitle}` : ""}
              </p>
            </div>
            <span className="text-right font-semibold">{inr.format(r.price)}</span>
            <span className="text-right">
              {r.expert_payout != null ? inr.format(r.expert_payout) : "—"}
            </span>
            <span className="text-right">
              {r.area_partner_payout != null ? inr.format(r.area_partner_payout) : "—"}
            </span>
            <span className="text-right">
              {r.hq_revenue != null ? inr.format(r.hq_revenue) : "—"}
            </span>
            <span>
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                  r.is_active
                    ? "bg-primary-tint text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {r.is_active ? "active" : "inactive"}
              </span>
            </span>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingId(r.id)}
                className="h-9 px-3 rounded-[12px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted"
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                aria-label={`Delete ${r.duration_label}`}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `This will permanently delete "${r.duration_label}", are you sure? This cannot be undone.`,
                    )
                  ) {
                    deleteMutation.mutate(r.id);
                  }
                }}

                className="h-9 w-9 rounded-[12px] border border-border text-destructive inline-flex items-center justify-center hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingRow && (
        <EditPriceModal row={editingRow} onClose={() => setEditingId(null)} />
      )}

      {creating && (
        <CreatePriceModal
          categories={categories}
          defaultCategoryId={defaultCategoryId}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function EditPriceModal({ row, onClose }: { row: ServicePriceRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateServicePrice);
  const [label, setLabel] = useState(row.duration_label);
  const [sub, setSub] = useState(row.subtitle ?? "");
  const [price, setPrice] = useState(String(row.price));
  const [expert, setExpert] = useState(row.expert_payout != null ? String(row.expert_payout) : "");
  const [partner, setPartner] = useState(
    row.area_partner_payout != null ? String(row.area_partner_payout) : "",
  );
  const [hq, setHq] = useState(row.hq_revenue != null ? String(row.hq_revenue) : "");
  const [active, setActive] = useState(row.is_active);
  const [error, setError] = useState<string | null>(null);

  function parseNonNeg(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    if (!isFinite(n) || n < 0) throw new Error("Prices must be positive numbers");
    return n;
  }

  const mutation = useMutation({
    mutationFn: () => {
      try {
        const p = parseNonNeg(price);
        if (p == null) throw new Error("Customer price is required");
        if (!label.trim()) throw new Error("Duration title is required");
        return save({
          data: {
            id: row.id,
            duration_label: label.trim(),
            subtitle: sub.trim() ? sub.trim() : null,
            price: p,
            expert_payout: parseNonNeg(expert),
            area_partner_payout: parseNonNeg(partner),
            hq_revenue: parseNonNeg(hq),
            is_active: active,
          },
        });

      } catch (e) {
        return Promise.reject(e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-catalogue"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Save failed"),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[520px] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Edit pricing
            </p>
            <h2 className="text-[18px] font-bold text-foreground">{row.duration_label}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={20} />
          </button>
        </header>
        <div className="px-6 py-6 space-y-4">
          <TextField
            label="Duration Title"
            value={label}
            onChange={setLabel}
            required
            placeholder="e.g. 3 Hours"
          />
          <TextField
            label="Subtitle / Timing Note"
            value={sub}
            onChange={setSub}
            placeholder="e.g. Complete Cleaning"
          />
          <NumField label="Customer Price (₹)" value={price} onChange={setPrice} required />

          <div className="grid grid-cols-2 gap-4">
            <NumField label="Expert Payout (₹)" value={expert} onChange={setExpert} />
            <NumField
              label="Partner Commission (₹)"
              value={partner}
              onChange={setPartner}
            />
          </div>
          <NumField label="HQ Share (₹)" value={hq} onChange={setHq} />

          <label className="flex items-center justify-between gap-3 p-3 rounded-[14px] border border-border">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Active</p>
              <p className="text-[12px] text-muted-foreground">
                Only active durations show up as bookable slots.
              </p>
            </div>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-5 h-5 accent-primary"
            />
          </label>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[14px] border border-border text-foreground font-semibold text-[14px]"
          >
            Cancel
          </button>
          <button
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            className="h-11 px-5 rounded-[14px] bg-primary text-white font-bold text-[14px] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Check size={16} />
            {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      />
    </div>
  );
}

function NumField({

  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        type="number"
        min={0}
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 px-3 rounded-[14px] border border-border bg-card text-[14px]"
      />
    </div>
  );
}

function CreatePriceModal({
  categories,
  defaultCategoryId,
  onClose,
}: {
  categories: { id: string; name: string; slug: string }[];
  defaultCategoryId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const create = useServerFn(createServicePriceRow);
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [price, setPrice] = useState("");
  const [expert, setExpert] = useState("");
  const [partner, setPartner] = useState("");
  const [hq, setHq] = useState("");
  const [error, setError] = useState<string | null>(null);

  function parseNonNeg(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    if (!isFinite(n) || n < 0) throw new Error("Amounts must be positive numbers");
    return n;
  }

  const mutation = useMutation({
    mutationFn: () => {
      try {
        const p = parseNonNeg(price);
        if (p == null) throw new Error("Customer price is required");
        const m = parseNonNeg(minutes);
        if (!m) throw new Error("Duration in minutes is required");
        if (!label.trim()) throw new Error("Duration label is required");
        return create({
          data: {
            service_category_id: categoryId || null,
            duration_label: label.trim(),
            duration_minutes: Math.round(m),
            subtitle: subtitle.trim() || null,
            price: p,
            expert_payout: parseNonNeg(expert),
            area_partner_payout: parseNonNeg(partner),
            hq_revenue: parseNonNeg(hq),
          },
        });
      } catch (e) {
        return Promise.reject(e);
      }
    },
    onSuccess: () => {
      toast.success("Pricing row created");
      queryClient.invalidateQueries({ queryKey: ["service-catalogue"] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Create failed"),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const field =
    "w-full h-11 px-3 rounded-[12px] border border-border bg-card text-[14px] text-foreground";
  const labelCls =
    "block text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-foreground/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full sm:max-w-[560px] sm:rounded-[24px] overflow-hidden shadow-xl flex flex-col max-h-full"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Service catalogue
            </p>
            <h2 className="text-[18px] font-bold text-foreground">New duration / price row</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full inline-flex items-center justify-center hover:bg-muted"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div>
            <label className={labelCls}>Service category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={field}
            >
              {categories.length === 0 && <option value="">Home Cleaning (default)</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Duration label</label>
              <input
                className={field}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="3 Hours"
              />
            </div>
            <div>
              <label className={labelCls}>Duration (minutes)</label>
              <input
                className={field}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                inputMode="numeric"
                placeholder="180"
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Subtitle (optional)</label>
            <input
              className={field}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Best for 2BHK"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Customer price</label>
              <input
                className={field}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className={labelCls}>Expert payout</label>
              <input
                className={field}
                value={expert}
                onChange={(e) => setExpert(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className={labelCls}>Partner commission</label>
              <input
                className={field}
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className={labelCls}>HQ share</label>
              <input
                className={field}
                value={hq}
                onChange={(e) => setHq(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-[12px] border border-border font-semibold text-[14px] hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            className="h-11 px-5 rounded-[12px] bg-primary text-primary-foreground font-bold text-[14px] inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Check size={16} /> Create row
          </button>
        </footer>
      </div>
    </div>
  );
}
