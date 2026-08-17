import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import {
  setAvailabilityOverride,
  clearAvailabilityOverride,
  isEffectivelyUnavailable,
  type AvailabilityOverride,
  type CatalogueCategory,
  type CataloguePriceOption,
  type CatalogueService,
} from "@/lib/catalogue.functions";

const ALL = "__all__";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function availabilityLabel(o: AvailabilityOverride): string {
  if (o.is_unavailable) return "Manually switched off";
  if (o.unavailable_from && o.unavailable_until) {
    const f = new Date(o.unavailable_from);
    const t = new Date(o.unavailable_until);
    const fmt = (d: Date) =>
      d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    return `Scheduled ${fmt(f)} → ${fmt(t)}`;
  }
  return "Available";
}

export function AvailabilityBadge({ override }: { override?: AvailabilityOverride }) {
  if (!override) return null;
  const off = isEffectivelyUnavailable(override);
  const scheduled =
    !off && !!override.unavailable_from && !!override.unavailable_until;
  if (!off && !scheduled) return null;
  const title = [availabilityLabel(override), override.reason]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
        off
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {!off && <CalendarClock size={10} />}
      {off ? "unavailable" : "scheduled"}
    </span>
  );
}

export function AvailabilityModal({
  category,
  services,
  options,
  overrides,
  onClose,
}: {
  category: CatalogueCategory;
  services: CatalogueService[];
  options: CataloguePriceOption[];
  overrides: AvailabilityOverride[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useServerFn(setAvailabilityOverride);
  const clear = useServerFn(clearAvailabilityOverride);

  const items = useMemo(() => {
    const svcById = new Map(services.map((s) => [s.id, s]));
    return options
      .filter((o) => svcById.has(o.service_id))
      .map((o) => ({
        id: o.id,
        label: `${svcById.get(o.service_id)!.name} · ${o.label}`,
      }));
  }, [services, options]);

  const [target, setTarget] = useState<string>(ALL);
  const existing = overrides.find(
    (o) =>
      (target === ALL && o.target_type === "category" && o.target_id === category.id) ||
      (target !== ALL && o.target_type === "item" && o.target_id === target),
  );

  const [unavailable, setUnavailable] = useState(existing?.is_unavailable ?? false);
  const [from, setFrom] = useState(toLocalInput(existing?.unavailable_from ?? null));
  const [until, setUntil] = useState(toLocalInput(existing?.unavailable_until ?? null));
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [loadedFor, setLoadedFor] = useState(target);

  if (loadedFor !== target) {
    setLoadedFor(target);
    setUnavailable(existing?.is_unavailable ?? false);
    setFrom(toLocalInput(existing?.unavailable_from ?? null));
    setUntil(toLocalInput(existing?.unavailable_until ?? null));
    setReason(existing?.reason ?? "");
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["catalogue"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          target_type: target === ALL ? "category" : "item",
          target_ids: [target === ALL ? category.id : target],
          is_unavailable: unavailable,
          unavailable_from: fromLocalInput(from),
          unavailable_until: fromLocalInput(until),
          reason: reason.trim() ? reason.trim() : null,
        },
      }),
    onSuccess: () => {
      toast.success("Availability updated");
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const clearMutation = useMutation({
    mutationFn: () =>
      clear({
        data: {
          target_type: target === ALL ? "category" : "item",
          target_ids: [target === ALL ? category.id : target],
        },
      }),
    onSuccess: () => {
      toast.success("Override removed");
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-[520px] max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[15px] font-bold text-foreground">
            Availability · {category.name}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Select service(s)
            </span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="mt-1 w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[14px]"
            >
              <option value={ALL}>All — entire "{category.name}" category</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between border border-border rounded-[12px] px-4 py-3">
            <div>
              <p className="text-[14px] font-semibold text-foreground">
                {unavailable ? "Not available" : "Available"}
              </p>
              <p className="text-[12px] text-muted-foreground">Instant manual switch</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={unavailable}
              onClick={() => setUnavailable((v) => !v)}
              className={`h-7 w-12 rounded-full transition-colors relative ${
                unavailable ? "bg-destructive" : "bg-primary"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-card transition-all ${
                  unavailable ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">
                Unavailable from
              </span>
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[13px]"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-muted-foreground">Until</span>
              <input
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[13px]"
              />
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A schedule takes effect and clears automatically — no need to toggle back.
          </p>

          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Reason (internal)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Expert on leave"
              className="mt-1 w-full h-10 px-3 rounded-[12px] border border-border bg-background text-[14px]"
            />
          </label>
        </div>

        <footer className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={() => clearMutation.mutate()}
            disabled={!existing || clearMutation.isPending}
            className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold disabled:opacity-40"
          >
            Remove override
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="h-10 px-5 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-60"
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
