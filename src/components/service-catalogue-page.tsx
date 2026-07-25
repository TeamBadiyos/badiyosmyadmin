import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Check, X } from "lucide-react";
import {
  listServicePrices,
  updateServicePrice,
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRow = data.find((r) => r.id === editingId) ?? null;

  return (
    <div className="space-y-6">
      <p className="text-[14px] text-muted-foreground">
        Customer prices and payout splits per service duration. Super admin only.
      </p>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_140px_120px_100px_80px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
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
        {!isLoading && !isError && data.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">No pricing rows yet.</p>
        )}

        {data.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,1.2fr)_120px_120px_140px_120px_100px_80px] gap-4 items-center px-6 py-4 border-b border-border last:border-b-0 text-[14px]"
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
            <div className="flex justify-end">
              <button
                onClick={() => setEditingId(r.id)}
                className="h-9 px-3 rounded-[12px] border border-border text-foreground font-semibold text-[13px] inline-flex items-center gap-1 hover:bg-muted"
              >
                <Pencil size={14} /> Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingRow && (
        <EditPriceModal row={editingRow} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

function EditPriceModal({ row, onClose }: { row: ServicePriceRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const save = useServerFn(updateServicePrice);
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
        return save({
          data: {
            id: row.id,
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
