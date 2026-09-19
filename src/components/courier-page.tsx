import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  History,
  Package,
  Pencil,
  Plus,
  Power,
  Truck,
  X,
} from "lucide-react";
import {
  COURIER_STATUSES,
  confirmRate,
  forceCancelOrder,
  getCourierAccess,
  listCourierOrderEvents,
  listCourierOrders,
  listCourierRiders,
  listCourierTypes,
  listRates,
  listServiceFlags,
  listVehicleTypes,
  refundOrder,
  reassignRider,
  resolveIncident,
  saveCourierType,
  saveRate,
  saveVehicleType,
  setCourierTypeActive,
  setServiceFlag,
  setVehicleCourierType,
  setVehicleTypeActive,
  type CourierOrderRow,
  type CourierTypeRow,
  type RateRow,
  type ServiceFlagRow,
  type VehicleTypeRow,
} from "@/lib/courier.functions";

/* --------------------------------- shared -------------------------------- */

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-secondary/40 p-4 sm:p-8">
      <div
        className={`modal-pop w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-[18px] border border-border bg-card p-6 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-[16px] font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-[10px] p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground";

function Pill({ tone, children }: { tone: "ok" | "warn" | "off" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-primary/10 text-primary"
      : tone === "warn"
        ? "bg-warning/15 text-warning"
        : tone === "info"
          ? "bg-info/10 text-info"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
  );
}

function Toggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-primary" : "bg-border"}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

const TABS = [
  { key: "flags", label: "Service Toggle" },
  { key: "vehicles", label: "Vehicle Types" },
  { key: "rates", label: "Rates" },
  { key: "types", label: "Courier Types" },
  { key: "orders", label: "Live Orders" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/* ------------------------------ 1. Service flags -------------------------- */

function ServiceFlagsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchFlags = useServerFn(listServiceFlags);
  const save = useServerFn(setServiceFlag);
  const [confirming, setConfirming] = useState<ServiceFlagRow | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ["courier", "flags"], queryFn: () => fetchFlags() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["courier", "flags"] });

  async function apply(row: ServiceFlagRow, isActive: boolean) {
    setBusy(true);
    try {
      await save({ data: { serviceKey: row.service_key, city: row.city, isActive } });
      toast.success(isActive ? "Service turned on" : "Service turned off");
      setConfirming(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const rows = data ?? [];

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No services configured yet.</p>
      ) : null}
      {rows.map((r) => (
        <div
          key={r.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-card p-4"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-foreground">
                {r.label ?? r.service_key}
              </span>
              <Pill tone="info">{r.city}</Pill>
              {r.is_active ? <Pill tone="ok">On</Pill> : <Pill tone="off">Off</Pill>}
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {r.activeOrders} active order{r.activeOrders === 1 ? "" : "s"} right now
            </p>
          </div>
          <Toggle
            on={r.is_active}
            disabled={!canWrite || busy}
            onChange={(next) => (next ? apply(r, true) : setConfirming(r))}
          />
        </div>
      ))}

      {confirming ? (
        <Modal title="Turn this service off?" onClose={() => setConfirming(null)}>
          <div className="rounded-[12px] border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-center gap-2 text-[13px] font-bold text-foreground">
              <AlertTriangle size={15} className="text-warning" />
              {confirming.label ?? confirming.service_key} — {confirming.city}
            </div>
            <p className="mt-2 text-[13px] text-foreground">
              There {confirming.activeOrders === 1 ? "is" : "are"}{" "}
              <strong>{confirming.activeOrders}</strong> active order
              {confirming.activeOrders === 1 ? "" : "s"} on this service. Turning it off stops new
              orders; running ones continue.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setConfirming(null)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Keep it on
            </button>
            <button
              onClick={() => apply(confirming, false)}
              disabled={busy}
              className="rounded-[10px] bg-destructive px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ----------------------------- 2. Vehicle types --------------------------- */

type VehicleDraft = {
  id: string | null;
  name: string;
  icon: string;
  maxWeightKg: string;
  inclusions: string;
  exclusions: string;
  requiredSkill: string;
  requiredDocuments: string;
  sortOrder: string;
  isActive: boolean;
};

function toDraft(v?: VehicleTypeRow): VehicleDraft {
  return {
    id: v?.id ?? null,
    name: v?.name ?? "",
    icon: v?.icon ?? "",
    maxWeightKg: String(v?.max_weight_kg ?? 20),
    inclusions: (v?.inclusions ?? []).join(", "),
    exclusions: (v?.exclusions ?? []).join(", "),
    requiredSkill: v?.required_skill ?? "",
    requiredDocuments: (v?.required_documents ?? []).join(", "),
    sortOrder: String(v?.sort_order ?? 0),
    isActive: v?.is_active ?? false,
  };
}

const splitList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function VehicleTypesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchVehicles = useServerFn(listVehicleTypes);
  const save = useServerFn(saveVehicleType);
  const toggle = useServerFn(setVehicleTypeActive);
  const [draft, setDraft] = useState<VehicleDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ["courier", "vehicles"], queryFn: () => fetchVehicles() });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["courier", "vehicles"] });
    qc.invalidateQueries({ queryKey: ["courier", "rates"] });
    qc.invalidateQueries({ queryKey: ["courier", "types"] });
  };

  async function submit() {
    if (!draft) return;
    setBusy(true);
    try {
      await save({
        data: {
          id: draft.id,
          name: draft.name,
          icon: draft.icon || null,
          maxWeightKg: Number(draft.maxWeightKg || 0),
          inclusions: splitList(draft.inclusions),
          exclusions: splitList(draft.exclusions),
          requiredSkill: draft.requiredSkill || null,
          requiredDocuments: splitList(draft.requiredDocuments),
          sortOrder: Number(draft.sortOrder || 0),
          isActive: draft.isActive,
        },
      });
      toast.success("Vehicle type saved");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows ?? [];
  const skills = data?.skills ?? [];

  return (
    <div className="space-y-3">
      {canWrite ? (
        <button
          onClick={() => setDraft(toDraft())}
          className="flex items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground"
        >
          <Plus size={14} /> New vehicle type
        </button>
      ) : null}

      {rows.map((v) => (
        <div key={v.id} className="rounded-[16px] border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-primary" />
              <span className="text-[14px] font-bold text-foreground">{v.name}</span>
              <Pill tone="info">up to {v.max_weight_kg} kg</Pill>
              {v.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Inactive</Pill>}
            </div>
            <div className="flex items-center gap-2">
              {canWrite ? (
                <button
                  onClick={() => setDraft(toDraft(v))}
                  className="flex items-center gap-1 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                >
                  <Pencil size={13} /> Edit
                </button>
              ) : null}
              <Toggle
                on={v.is_active}
                disabled={!canWrite}
                onChange={async (next) => {
                  try {
                    await toggle({ data: { id: v.id, isActive: next } });
                    refresh();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Update failed");
                  }
                }}
              />
            </div>
          </div>
          <div className="mt-2 grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-2">
            <span>Includes: {v.inclusions.join(", ") || "—"}</span>
            <span>Excludes: {v.exclusions.join(", ") || "—"}</span>
            <span>Documents: {v.required_documents.join(", ") || "—"}</span>
            <span>
              Skill:{" "}
              {skills.find((s) => s.id === v.required_skill)?.name ?? (v.required_skill ? "—" : "Any")}
            </span>
          </div>
        </div>
      ))}

      {draft ? (
        <Modal title={draft.id ? "Edit vehicle type" : "New vehicle type"} onClose={() => setDraft(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Icon" hint="Icon name or image URL">
              <input
                className={inputCls}
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
              />
            </Field>
            <Field label="Max weight (kg)">
              <input
                type="number"
                className={inputCls}
                value={draft.maxWeightKg}
                onChange={(e) => setDraft({ ...draft, maxWeightKg: e.target.value })}
              />
            </Field>
            <Field label="Sort order">
              <input
                type="number"
                className={inputCls}
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
              />
            </Field>
            <Field label="Inclusions" hint="Comma separated">
              <input
                className={inputCls}
                value={draft.inclusions}
                onChange={(e) => setDraft({ ...draft, inclusions: e.target.value })}
              />
            </Field>
            <Field label="Exclusions" hint="Comma separated">
              <input
                className={inputCls}
                value={draft.exclusions}
                onChange={(e) => setDraft({ ...draft, exclusions: e.target.value })}
              />
            </Field>
            <Field label="Required skill">
              <select
                className={inputCls}
                value={draft.requiredSkill}
                onChange={(e) => setDraft({ ...draft, requiredSkill: e.target.value })}
              >
                <option value="">Any</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Required documents" hint="Comma separated">
              <input
                className={inputCls}
                value={draft.requiredDocuments}
                onChange={(e) => setDraft({ ...draft, requiredDocuments: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Toggle on={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
            <span className="text-[13px] text-foreground">Active</span>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setDraft(null)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* --------------------------------- 3. Rates -------------------------------- */

type RateDraft = {
  id: string | null;
  city: string;
  vehicleTypeId: string;
  baseFare: string;
  includedKm: string;
  perKm: string;
  minFare: string;
  platformFee: string;
  commissionPct: string;
};

function rateDraft(r?: RateRow, firstVehicle?: string): RateDraft {
  return {
    id: r?.id ?? null,
    city: r?.city ?? "",
    vehicleTypeId: r?.vehicle_type_id ?? firstVehicle ?? "",
    baseFare: String(r?.base_fare ?? 0),
    includedKm: String(r?.included_km ?? 0),
    perKm: String(r?.per_km ?? 0),
    minFare: String(r?.min_fare ?? 0),
    platformFee: String(r?.platform_fee ?? 0),
    commissionPct: String(r?.commission_pct ?? 0),
  };
}

function RatesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchRates = useServerFn(listRates);
  const save = useServerFn(saveRate);
  const confirm = useServerFn(confirmRate);
  const [draft, setDraft] = useState<RateDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ["courier", "rates"], queryFn: () => fetchRates() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["courier", "rates"] });

  const rows = data?.rows ?? [];
  const vehicles = data?.vehicles ?? [];

  async function submit() {
    if (!draft) return;
    setBusy(true);
    try {
      await save({
        data: {
          id: draft.id,
          city: draft.city,
          vehicleTypeId: draft.vehicleTypeId,
          baseFare: Number(draft.baseFare || 0),
          includedKm: Number(draft.includedKm || 0),
          perKm: Number(draft.perKm || 0),
          minFare: Number(draft.minFare || 0),
          platformFee: Number(draft.platformFee || 0),
          commissionPct: Number(draft.commissionPct || 0),
        },
      });
      toast.success("Rate saved");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-muted-foreground">
          Cancellation fee (all cities): ₹{data?.cancellationFee ?? 0} — set in ops settings.
        </p>
        {canWrite ? (
          <button
            onClick={() => setDraft(rateDraft(undefined, vehicles[0]?.id))}
            className="flex items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground"
          >
            <Plus size={14} /> New rate
          </button>
        ) : null}
      </div>

      {rows.map((r) => (
        <div key={r.id} className="rounded-[16px] border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bike size={16} className="text-primary" />
              <span className="text-[14px] font-bold text-foreground">{r.vehicleName}</span>
              <Pill tone="info">{r.city}</Pill>
              {r.is_placeholder ? <Pill tone="warn">Placeholder</Pill> : <Pill tone="ok">Confirmed</Pill>}
            </div>
            <div className="flex items-center gap-2">
              {canWrite ? (
                <button
                  onClick={() => setDraft(rateDraft(r))}
                  className="flex items-center gap-1 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                >
                  <Pencil size={13} /> Edit
                </button>
              ) : null}
              {canWrite && r.is_placeholder ? (
                <button
                  onClick={async () => {
                    try {
                      await confirm({ data: { id: r.id } });
                      toast.success("Rate marked as confirmed");
                      refresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Update failed");
                    }
                  }}
                  className="flex items-center gap-1 rounded-[10px] bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground"
                >
                  <CheckCircle2 size={13} /> Mark as confirmed
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-2 grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-3">
            <span>Base ₹{r.base_fare} · {r.included_km} km included</span>
            <span>Per km ₹{r.per_km} · Min ₹{r.min_fare}</span>
            <span>Platform ₹{r.platform_fee} · Commission {r.commission_pct}%</span>
          </div>
        </div>
      ))}

      {draft ? (
        <Modal title={draft.id ? "Edit rate" : "New rate"} onClose={() => setDraft(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City">
              <input
                className={inputCls}
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
            </Field>
            <Field label="Vehicle">
              <select
                className={inputCls}
                value={draft.vehicleTypeId}
                onChange={(e) => setDraft({ ...draft, vehicleTypeId: e.target.value })}
              >
                <option value="">Select</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            {(
              [
                ["Base fare (₹)", "baseFare"],
                ["Included km", "includedKm"],
                ["Per km (₹)", "perKm"],
                ["Min fare (₹)", "minFare"],
                ["Platform fee (₹)", "platformFee"],
                ["Commission (%)", "commissionPct"],
              ] as Array<[string, keyof RateDraft]>
            ).map(([label, key]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  className={inputCls}
                  value={String(draft[key] ?? "")}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setDraft(null)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* --------------------- 4. Courier types + mapping grid --------------------- */

type TypeDraft = {
  id: string | null;
  name: string;
  icon: string;
  extraFee: string;
  instructions: string;
  sortOrder: string;
  isActive: boolean;
};

function typeDraft(t?: CourierTypeRow): TypeDraft {
  return {
    id: t?.id ?? null,
    name: t?.name ?? "",
    icon: t?.icon ?? "",
    extraFee: String(t?.extra_fee ?? 0),
    instructions: t?.instructions ?? "",
    sortOrder: String(t?.sort_order ?? 0),
    isActive: t?.is_active ?? true,
  };
}

function CourierTypesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchTypes = useServerFn(listCourierTypes);
  const save = useServerFn(saveCourierType);
  const toggle = useServerFn(setCourierTypeActive);
  const setMapping = useServerFn(setVehicleCourierType);
  const [draft, setDraft] = useState<TypeDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ["courier", "types"], queryFn: () => fetchTypes() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["courier", "types"] });

  const rows = data?.rows ?? [];
  const vehicles = data?.vehicles ?? [];
  const mapping = data?.mapping ?? [];
  const mapKey = (v: string, t: string) => `${v}:${t}`;
  const mapSet = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of mapping) m.set(mapKey(r.vehicle_type_id, r.courier_type_id), r.is_active);
    return m;
  }, [mapping]);

  async function submit() {
    if (!draft) return;
    setBusy(true);
    try {
      await save({
        data: {
          id: draft.id,
          name: draft.name,
          icon: draft.icon || null,
          extraFee: Number(draft.extraFee || 0),
          instructions: draft.instructions || null,
          sortOrder: Number(draft.sortOrder || 0),
          isActive: draft.isActive,
        },
      });
      toast.success("Courier type saved");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <button
          onClick={() => setDraft(typeDraft())}
          className="flex items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground"
        >
          <Plus size={14} /> New courier type
        </button>
      ) : null}

      <div className="space-y-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-[16px] border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-primary" />
                <span className="text-[14px] font-bold text-foreground">{t.name}</span>
                {t.extra_fee > 0 ? <Pill tone="info">+₹{t.extra_fee}</Pill> : null}
                {t.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Inactive</Pill>}
              </div>
              <div className="flex items-center gap-2">
                {canWrite ? (
                  <button
                    onClick={() => setDraft(typeDraft(t))}
                    className="flex items-center gap-1 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                ) : null}
                <Toggle
                  on={t.is_active}
                  disabled={!canWrite}
                  onChange={async (next) => {
                    try {
                      await toggle({ data: { id: t.id, isActive: next } });
                      refresh();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Update failed");
                    }
                  }}
                />
              </div>
            </div>
            {t.instructions ? (
              <p className="mt-2 text-[12px] text-muted-foreground">{t.instructions}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="rounded-[16px] border border-border bg-card p-4">
        <h4 className="text-[14px] font-bold text-foreground">Allowed on which vehicle</h4>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-4 font-semibold">Parcel type</th>
                {vehicles.map((v) => (
                  <th key={v.id} className="py-2 pr-4 font-semibold">
                    {v.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-semibold text-foreground">{t.name}</td>
                  {vehicles.map((v) => {
                    const on = mapSet.get(mapKey(v.id, t.id)) ?? false;
                    return (
                      <td key={v.id} className="py-2 pr-4">
                        <Toggle
                          on={on}
                          disabled={!canWrite}
                          onChange={async (next) => {
                            try {
                              await setMapping({
                                data: { vehicleTypeId: v.id, courierTypeId: t.id, isActive: next },
                              });
                              refresh();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Update failed");
                            }
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {draft ? (
        <Modal title={draft.id ? "Edit courier type" : "New courier type"} onClose={() => setDraft(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Icon">
              <input
                className={inputCls}
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
              />
            </Field>
            <Field label="Extra fee (₹)">
              <input
                type="number"
                className={inputCls}
                value={draft.extraFee}
                onChange={(e) => setDraft({ ...draft, extraFee: e.target.value })}
              />
            </Field>
            <Field label="Sort order">
              <input
                type="number"
                className={inputCls}
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Instructions">
              <textarea
                rows={3}
                className={inputCls}
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Toggle on={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} />
            <span className="text-[13px] text-foreground">Active</span>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setDraft(null)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------ 5. Live orders ---------------------------- */

function OrderDetail({
  order,
  canWrite,
  onClose,
  onChanged,
}: {
  order: CourierOrderRow;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const fetchEvents = useServerFn(listCourierOrderEvents);
  const fetchRiders = useServerFn(listCourierRiders);
  const doReassign = useServerFn(reassignRider);
  const doCancel = useServerFn(forceCancelOrder);
  const doRefund = useServerFn(refundOrder);
  const doResolve = useServerFn(resolveIncident);

  const [riderId, setRiderId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelRefund, setCancelRefund] = useState("0");
  const [refundAmount, setRefundAmount] = useState(String(order.total_amount));
  const [refundReason, setRefundReason] = useState("");
  const [resolution, setResolution] = useState<"full_refund" | "partial_refund" | "no_refund">(
    "full_refund",
  );
  const [resolveAmount, setResolveAmount] = useState(String(order.total_amount));
  const [payRider, setPayRider] = useState(true);
  const [busy, setBusy] = useState(false);

  const { data: events } = useQuery({
    queryKey: ["courier", "events", order.id],
    queryFn: () => fetchEvents({ data: { orderId: order.id } }),
  });
  const { data: riders } = useQuery({
    queryKey: ["courier", "riders"],
    queryFn: () => fetchRiders(),
    enabled: canWrite,
  });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Order ${order.order_code}`} onClose={onClose} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[12px] border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="info">{order.status}</Pill>
            {order.city ? <Pill tone="off">{order.city}</Pill> : null}
            {order.needs_ops_attention ? <Pill tone="warn">Needs attention</Pill> : null}
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Customer: {order.customerName ?? "—"}
            <br />
            Rider: {order.riderName ?? "Not assigned"}
            <br />
            Amount: ₹{order.total_amount} · Payment {order.payment_status ?? "—"}
            {order.refund_status ? ` · Refund ${order.refund_status}` : ""}
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Pickup: {order.pickup_address ?? "—"}
            <br />
            Drop: {order.drop_address ?? "—"}
          </p>
          {order.incident_code ? (
            <p className="mt-2 text-[12px] font-semibold text-warning">
              Incident: {order.incident_code}
              {order.incident_resolution ? ` · resolved (${order.incident_resolution})` : ""}
            </p>
          ) : null}
        </div>

        <div className="rounded-[12px] border border-border p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
            <History size={14} className="text-primary" /> Event history
          </div>
          <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
            {(events ?? []).map((ev) => (
              <div key={ev.id} className="text-[12px]">
                <span className="font-semibold text-foreground">
                  {ev.from_status ? `${ev.from_status} → ` : ""}
                  {ev.to_status}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {new Date(ev.created_at).toLocaleString()} · {ev.actor_type ?? "system"}
                </span>
              </div>
            ))}
            {(events ?? []).length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No events yet.</p>
            ) : null}
          </div>
        </div>
      </div>

      {canWrite ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-[12px] border border-border p-3">
            <h4 className="text-[13px] font-bold text-foreground">Reassign rider</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className={`${inputCls} max-w-xs`}
                value={riderId}
                onChange={(e) => setRiderId(e.target.value)}
              >
                <option value="">Select rider</option>
                {(riders ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.phone}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || !riderId}
                onClick={() =>
                  run(() => doReassign({ data: { orderId: order.id, expertId: riderId } }), "Rider reassigned")
                }
                className="rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
              >
                Reassign
              </button>
            </div>
          </div>

          <div className="rounded-[12px] border border-border p-3">
            <h4 className="text-[13px] font-bold text-foreground">Force cancel</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                placeholder="Reason"
                className={`${inputCls} max-w-xs`}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <input
                type="number"
                placeholder="Refund ₹"
                className={`${inputCls} max-w-[140px]`}
                value={cancelRefund}
                onChange={(e) => setCancelRefund(e.target.value)}
              />
              <button
                disabled={busy || !cancelReason.trim()}
                onClick={() =>
                  run(
                    () =>
                      doCancel({
                        data: {
                          orderId: order.id,
                          reason: cancelReason,
                          refundAmount: Number(cancelRefund || 0),
                        },
                      }),
                    "Order cancelled",
                  )
                }
                className="rounded-[10px] bg-destructive px-3.5 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
              >
                <span className="flex items-center gap-1">
                  <Power size={13} /> Cancel order
                </span>
              </button>
            </div>
          </div>

          <div className="rounded-[12px] border border-border p-3">
            <h4 className="text-[13px] font-bold text-foreground">Refund</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                type="number"
                className={`${inputCls} max-w-[140px]`}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
              <input
                placeholder="Reason"
                className={`${inputCls} max-w-xs`}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
              <button
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      doRefund({
                        data: {
                          orderId: order.id,
                          amount: Number(refundAmount || 0),
                          reason: refundReason,
                        },
                      }),
                    "Refund queued",
                  )
                }
                className="rounded-[10px] border border-border px-3.5 py-2 text-[12px] font-bold text-foreground hover:bg-muted disabled:opacity-50"
              >
                Refund
              </button>
            </div>
          </div>

          {order.status === "FAILED_DELIVERY" ? (
            <div className="rounded-[12px] border border-warning/40 bg-warning/10 p-3">
              <h4 className="text-[13px] font-bold text-foreground">Resolve failed delivery</h4>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className={`${inputCls} max-w-[200px]`}
                  value={resolution}
                  onChange={(e) =>
                    setResolution(e.target.value as "full_refund" | "partial_refund" | "no_refund")
                  }
                >
                  <option value="full_refund">Full refund</option>
                  <option value="partial_refund">Partial refund</option>
                  <option value="no_refund">No refund</option>
                </select>
                {resolution !== "no_refund" ? (
                  <input
                    type="number"
                    className={`${inputCls} max-w-[140px]`}
                    value={resolveAmount}
                    onChange={(e) => setResolveAmount(e.target.value)}
                  />
                ) : null}
                <label className="flex items-center gap-2 text-[12px] text-foreground">
                  <Toggle on={payRider} onChange={setPayRider} /> Pay the rider
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        doResolve({
                          data: {
                            orderId: order.id,
                            resolution,
                            refundAmount:
                              resolution === "full_refund"
                                ? order.total_amount
                                : Number(resolveAmount || 0),
                            payRider,
                          },
                        }),
                      "Incident resolved",
                    )
                  }
                  className="rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
                >
                  Resolve
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted-foreground">
          You have read-only access to courier orders.
        </p>
      )}
    </Modal>
  );
}

function OrdersTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchOrders = useServerFn(listCourierOrders);
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CourierOrderRow | null>(null);

  const { data } = useQuery({
    queryKey: ["courier", "orders", status, search],
    queryFn: () => fetchOrders({ data: { status: status || null, search: search || null } }),
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["courier", "orders"] });

  const rows = data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select
          className={`${inputCls} max-w-[200px]`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {COURIER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          placeholder="Search order code"
          className={`${inputCls} max-w-[240px]`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No courier orders found.</p>
      ) : null}

      {rows.map((o) => (
        <button
          key={o.id}
          onClick={() => setSelected(o)}
          className="block w-full rounded-[16px] border border-border bg-card p-4 text-left hover:bg-muted/40"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-bold text-foreground">{o.order_code}</span>
              <Pill tone="info">{o.status}</Pill>
              {o.needs_ops_attention ? <Pill tone="warn">Needs attention</Pill> : null}
            </div>
            <span className="text-[13px] font-bold text-foreground">₹{o.total_amount}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {o.customerName ?? "Customer"} · {o.riderName ?? "No rider"} ·{" "}
            {new Date(o.created_at).toLocaleString()}
          </p>
        </button>
      ))}

      {selected ? (
        <OrderDetail
          order={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onChanged={() => {
            refresh();
            qc.invalidateQueries({ queryKey: ["courier", "events", selected.id] });
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export function CourierPage() {
  const fetchAccess = useServerFn(getCourierAccess);
  const [tab, setTab] = useState<TabKey>("flags");

  const { data: access, isLoading, isError } = useQuery({
    queryKey: ["courier", "access"],
    queryFn: () => fetchAccess(),
    retry: false,
  });

  if (isLoading) return <p className="text-[13px] text-muted-foreground">Loading…</p>;
  if (isError || !access)
    return (
      <p className="text-[13px] text-muted-foreground">
        You do not have access to the courier console.
      </p>
    );

  const canWrite = access.canWrite;

  return (
    <div className="space-y-5">
      {!canWrite ? (
        <div className="rounded-[12px] border border-border bg-muted px-4 py-2 text-[12px] text-muted-foreground">
          Read-only access — only a super admin can change courier settings.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-[10px] px-3.5 py-2 text-[12px] font-semibold ${
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-foreground hover:bg-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "flags" ? <ServiceFlagsTab canWrite={canWrite} /> : null}
      {tab === "vehicles" ? <VehicleTypesTab canWrite={canWrite} /> : null}
      {tab === "rates" ? <RatesTab canWrite={canWrite} /> : null}
      {tab === "types" ? <CourierTypesTab canWrite={canWrite} /> : null}
      {tab === "orders" ? <OrdersTab canWrite={canWrite} /> : null}
    </div>
  );
}
