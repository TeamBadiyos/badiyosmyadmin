import { TripLeftBehind } from "@/components/left-behind";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterBar, FilterField, filterInputCls, filterSelectCls, countLabel } from "@/components/section-chrome";
import { StopProofs } from "@/components/drop-proofs";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
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
  getCourierOrderStops,
  getCancelFeeSettings,
  saveCancelFee,
  getOrderCancelFee,
  getCourierSettings,
  saveCourierSetting,
  verifyCourierStop,
  skipCourierStopScan,
  waiveCourierCharge,
  getCourierAccess,
  listCourierOrderEvents,
  listCourierOrders,
  listCourierRiders,
  listCourierTypes,
  listCourierZoneMapping,
  listRates,
  listVehicleTypes,
  refundOrder,
  reassignRider,
  resolveIncident,
  saveCourierType,
  saveCourierZoneMapping,
  saveRate,
  saveVehicleType,
  setCourierTypeActive,
  setVehicleCourierType,
  setVehicleTypeActive,
  type CourierOrderRow,
  type CourierTypeRow,
  type RateRow,
  type VehicleTypeRow,
} from "@/lib/courier.functions";
import { LiveTrackingMap } from "@/components/live-tracking-map";
import { ShareLocation } from "@/components/share-location";
import { listBusinesses } from "@/lib/bulk-courier.functions";
import { ExpertsPage } from "@/components/experts-page";
import { BulkCourierPage } from "@/components/bulk-courier-page";
import { OrderPaymentSummary } from "@/components/order-payment-summary";
import { NotifyStatsCard, ServiceHoursPanel } from "@/components/ops-panels";

/* --------------------------------- shared -------------------------------- */

export function Modal({
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

export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-secondary/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-[16px] font-bold text-foreground">{title}</h3>
          <button onClick={onClose} className="rounded-[10px] p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
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

export const inputCls =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground";

export function Pill({ tone, children }: { tone: "ok" | "warn" | "off" | "info"; children: React.ReactNode }) {
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

export type CourierSection = "orders" | "rates" | "types" | "settings" | "bulk" | "riders";
type TypeTab = "vehicles" | "types";

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
  segment: "regular" | "corporate";
  extraPickupFee: string;
  extraDropFee: string;
  maxPickups: string;
  maxDrops: string;
  noLimitPickups: boolean;
  noLimitDrops: boolean;
  returnPerKm: string;
};

function rateDraft(
  r?: RateRow,
  firstVehicle?: string,
  segment: "regular" | "corporate" = "regular",
): RateDraft {
  const seg = r?.customer_segment ?? segment;
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
    segment: seg,
    extraPickupFee: String(r?.extra_pickup_fee ?? 0),
    extraDropFee: String(r?.extra_drop_fee ?? 0),
    maxPickups: String(r ? (r.max_pickups ?? "") : 1),
    maxDrops: String(r ? (r.max_drops ?? "") : 1),
    noLimitPickups: seg === "corporate" && !!r && r.max_pickups == null,
    noLimitDrops: seg === "corporate" && !!r && r.max_drops == null,
    returnPerKm: String(r?.return_per_km ?? 0),
  };
}

function CancelFeeCard() {
  const qc = useQueryClient();
  const fetchFee = useServerFn(getCancelFeeSettings);
  const save = useServerFn(saveCancelFee);
  const { data } = useQuery({ queryKey: ["courier", "cancel-fee"], queryFn: () => fetchFee() });
  const [draft, setDraft] = useState<{ type: "percentage" | "fixed"; value: string; share: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = !!data?.canWrite;
  const d = draft ?? { type: data?.type ?? "percentage", value: String(data?.value ?? 0), share: String(data?.riderSharePct ?? 0) };
  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <h4 className="text-[13px] font-bold text-foreground">Cancellation fee (after rider reaches pickup)</h4>
      <p className="mt-1 text-[12px] text-muted-foreground">GST is added on the fee. The rest is refunded.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Type">
          <select disabled={!canEdit} className={inputCls} value={d.type} onChange={(e) => setDraft({ ...d, type: e.target.value as "percentage" | "fixed" })}>
            <option value="percentage">Percentage</option>
            <option value="fixed">Fixed ₹</option>
          </select>
        </Field>
        <Field label={d.type === "fixed" ? "Value (₹)" : "Value (%)"}>
          <input type="number" min={0} disabled={!canEdit} className={inputCls} value={d.value} onChange={(e) => setDraft({ ...d, value: e.target.value })} />
        </Field>
        <Field label="Rider's share of the fee (%)">
          <input type="number" min={0} max={100} disabled={!canEdit} className={inputCls} value={d.share} onChange={(e) => setDraft({ ...d, share: e.target.value })} />
        </Field>
      </div>
      {canEdit ? (
        <div className="mt-3 flex justify-end">
          <button
            disabled={busy || !draft}
            onClick={async () => {
              setBusy(true);
              try {
                await save({ data: { type: d.type, value: Number(d.value), riderSharePct: Number(d.share) } });
                toast.success("Cancellation fee saved");
                setDraft(null);
                qc.invalidateQueries({ queryKey: ["courier", "cancel-fee"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-[10px] bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Save
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground">Read-only — only a super admin can change this.</p>
      )}
    </div>
  );
}

function CourierSettingsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getCourierSettings);
  const save = useServerFn(saveCourierSetting);
  const { data } = useQuery({ queryKey: ["courier", "settings"], queryFn: () => fetchSettings() });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const changed = (data ?? []).filter((st) => vals[st.key] != null && vals[st.key] !== String(st.value));
  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <h4 className="text-[13px] font-bold text-foreground">Wait times</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(data ?? []).map((st) => (
          <Field key={st.key} label={st.label} hint={st.isDefault ? "Using default" : undefined}>
            <input type="number" min={1} max={120} disabled={!canEdit} className={inputCls}
              value={vals[st.key] ?? String(st.value)}
              onChange={(e) => setVals({ ...vals, [st.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      {canEdit ? (
        <div className="mt-3 flex justify-end">
          <button
            disabled={busy || changed.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                for (const st of changed) await save({ data: { key: st.key, value: Number(vals[st.key]) } });
                toast.success("Saved");
                setVals({});
                qc.invalidateQueries({ queryKey: ["courier", "settings"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-[10px] bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Save
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function RatesTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchRates = useServerFn(listRates);
  const save = useServerFn(saveRate);
  const confirm = useServerFn(confirmRate);
  const [draft, setDraft] = useState<RateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const segTab = "regular" as const;

  const { data } = useQuery({ queryKey: ["courier", "rates"], queryFn: () => fetchRates() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["courier", "rates"] });

  const rows = (data?.rows ?? []).filter((r) => r.customer_segment === segTab);
  const vehicles = data?.vehicles ?? [];

  async function submit() {
    if (!draft) return;
    const corp = draft.segment === "corporate";
    const maxP = corp && draft.noLimitPickups ? null : Number(draft.maxPickups || 0);
    const maxD = corp && draft.noLimitDrops ? null : Number(draft.maxDrops || 0);
    if ((maxP !== null && (!Number.isInteger(maxP) || maxP < 1)) || (maxD !== null && (!Number.isInteger(maxD) || maxD < 1))) {
      toast.error("Max pickups and max drops must be at least 1");
      return;
    }
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
          segment: draft.segment,
          extraPickupFee: Number(draft.extraPickupFee || 0),
          extraDropFee: Number(draft.extraDropFee || 0),
          maxPickups: maxP,
          maxDrops: maxD,
          returnPerKm: Number(draft.returnPerKm || 0),
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
        <span />
        {canWrite ? (
          <button
            onClick={() => setDraft(rateDraft(undefined, vehicles[0]?.id, segTab))}
            className="flex items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground"
          >
            <Plus size={14} /> New rate
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[16px] border border-border bg-card">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5">Vehicle</th>
              <th className="px-3 py-2.5">City</th>
              <th className="px-3 py-2.5 text-right">Base (incl. km)</th>
              <th className="px-3 py-2.5 text-right">Per km</th>
              <th className="px-3 py-2.5 text-right">Min fare</th>
              <th className="px-3 py-2.5 text-right">Extra stop</th>
              <th className="px-3 py-2.5 text-right">Return/km</th>
              <th className="px-3 py-2.5 text-right">Commission</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-4 text-muted-foreground">No rates yet.</td></tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5 font-bold text-foreground">
                  {r.vehicleName}
                  {r.is_placeholder ? <span className="ml-1.5"><Pill tone="warn">Placeholder</Pill></span> : null}
                </td>
                <td className="px-3 py-2.5 text-foreground">{r.city}</td>
                <td className="px-3 py-2.5 text-right">₹{r.base_fare} · {r.included_km} km</td>
                <td className="px-3 py-2.5 text-right">₹{r.per_km}</td>
                <td className="px-3 py-2.5 text-right">₹{r.min_fare}</td>
                <td className="px-3 py-2.5 text-right">₹{r.extra_drop_fee}</td>
                <td className="px-3 py-2.5 text-right">₹{r.return_per_km}</td>
                <td className="px-3 py-2.5 text-right">{r.commission_pct}%</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1.5">
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
                        className="flex items-center gap-1 rounded-[10px] border border-border px-2.5 py-1 text-[12px] font-semibold text-foreground hover:bg-muted"
                      >
                        <CheckCircle2 size={13} /> Confirm
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button
                        onClick={() => setDraft(rateDraft(r))}
                        className="flex items-center gap-1 rounded-[10px] border border-border px-2.5 py-1 text-[12px] font-semibold text-foreground hover:bg-muted"
                      >
                        <Pencil size={13} /> Edit
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft ? (
        <SidePanel title={draft.id ? "Edit rate" : "New rate"} onClose={() => setDraft(null)}>
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
          <div className="mt-4 rounded-[12px] border border-border p-3">
            <h4 className="text-[13px] font-bold text-foreground">Multi-stop charges</h4>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Base fare includes 1 pickup + 1 drop. Each additional stop adds the fee above.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Extra pickup fee (₹)">
                <input type="number" min={0} className={inputCls} value={draft.extraPickupFee}
                  onChange={(e) => setDraft({ ...draft, extraPickupFee: e.target.value })} />
              </Field>
              <Field label="Extra drop fee (₹)">
                <input type="number" min={0} className={inputCls} value={draft.extraDropFee}
                  onChange={(e) => setDraft({ ...draft, extraDropFee: e.target.value })} />
              </Field>
              {(
                [
                  ["Max pickups", "maxPickups", "noLimitPickups"],
                  ["Max drops", "maxDrops", "noLimitDrops"],
                ] as const
              ).map(([label, key, nl]) => (
                <Field key={key} label={label}>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} className={inputCls}
                      disabled={draft.segment === "corporate" && draft[nl]}
                      value={draft.segment === "corporate" && draft[nl] ? "" : draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                    {draft.segment === "corporate" ? (
                      <label className="flex shrink-0 items-center gap-1 text-[12px] text-foreground">
                        <input type="checkbox" checked={draft[nl]}
                          onChange={(e) => setDraft({ ...draft, [nl]: e.target.checked })} />
                        No limit
                      </label>
                    ) : null}
                  </div>
                </Field>
              ))}
              <Field label="Return charge per km (₹)">
                <input type="number" min={0} className={inputCls} value={draft.returnPerKm}
                  onChange={(e) => setDraft({ ...draft, returnPerKm: e.target.value })} />
              </Field>
            </div>
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
        </SidePanel>
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

export function OrderDetail({
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
  const fetchStops = useServerFn(getCourierOrderStops);
  const fetchCancelFee = useServerFn(getOrderCancelFee);
  const isCancelled = String(order.status).toUpperCase().startsWith("CANCEL");
  const { data: cancelFee } = useQuery({
    queryKey: ["courier", "cancel-fee-order", order.id],
    queryFn: () => fetchCancelFee({ data: { orderId: order.id } }),
    enabled: isCancelled,
  });

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
  const [panel, setPanel] = useState<null | "history" | "cancel" | "refund" | "resolve">(null);

  const { data: events } = useQuery({
    queryKey: ["courier", "events", order.id],
    queryFn: () => fetchEvents({ data: { orderId: order.id } }),
  });
  const { data: riders, refetch: refetchRiders } = useQuery({
    queryKey: ["courier", "riders", order.id],
    queryFn: () => fetchRiders({ data: { orderId: order.id } }),
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill tone="info">{order.status}</Pill>
          <Pill tone="off">Parcel</Pill>
          {order.city ? <Pill tone="off">{order.city}</Pill> : null}
          {order.needs_ops_attention ? <Pill tone="warn">Needs attention</Pill> : null}
          <span className="text-[13px] font-bold text-foreground">₹{order.total_amount}</span>
          <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${order.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
            {order.payment_status ?? "—"}
          </span>
        </div>
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="More actions" className="shrink-0 w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:bg-muted">
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => setPanel("history")}>Event history</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPanel("refund")}>Refund…</DropdownMenuItem>
              {order.status === "FAILED_DELIVERY" && <DropdownMenuItem onSelect={() => setPanel("resolve")}>Resolve failed delivery</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => setPanel("cancel")}>Cancel order…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground truncate">
        Placed {new Date(order.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        {order.refund_status ? ` · Refund ${order.refund_status}` : ""}
        {order.incident_code ? ` · Incident ${order.incident_code}${order.incident_resolution ? ` (resolved: ${order.incident_resolution})` : ""}` : ""}
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3 min-w-0">
          <div className="rounded-[14px] border border-border px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Customer</p>
            <p className="text-[14px] font-semibold text-foreground truncate">{order.customerName ?? "—"}</p>
          </div>
          <div className="rounded-[14px] border border-border px-3 py-2.5 text-[12px] space-y-1">
            <p><span className="font-semibold text-foreground">Pick-up: </span><span className="text-muted-foreground">{order.pickup_address ?? "—"}</span></p>
            <p><span className="font-semibold text-foreground">Drop: </span><span className="text-muted-foreground">{order.drop_address ?? "—"}</span></p>
          </div>
        </div>
        <div className="min-w-0">
          <LiveTrackingMap kind="courier" id={order.id} compact />
          <ShareLocationIcons kind="courier" id={order.id} />
        </div>
      </div>

      <div className="mt-3 rounded-[14px] border border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Rider</p>
          <p className="text-[13px] font-semibold text-foreground truncate">{order.riderName ?? "Not assigned"}</p>
        </div>
        {canWrite && (["REQUESTED", "SEARCHING", "DRIVER_ASSIGNED", "ARRIVED_PICKUP"].includes(order.status)) && (
          <div className="mt-1.5 max-h-48 overflow-y-auto divide-y divide-border rounded-[10px] border border-border">
            {(riders ?? []).length === 0 && <p className="px-3 py-2 text-[12px] text-muted-foreground">No eligible riders.</p>}
            {[...(riders ?? [])]
              .sort((x, y) => Number(y.is_online) - Number(x.is_online) || (x.distance_km ?? 1e9) - (y.distance_km ?? 1e9))
              .map((r) => (
                <button key={r.id} type="button" disabled={busy}
                  onClick={() => {
                    if (!confirm(`${order.riderName ? "Reassign to" : "Assign"} ${r.name}?`)) return;
                    void run(async () => { await doReassign({ data: { orderId: order.id, expertId: r.id } }); await refetchRiders(); }, "Rider assigned and notified");
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-50">
                  <span className="text-[13px] font-semibold text-foreground truncate">{r.name}</span>
                  <span className="shrink-0 flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">{r.distance_km != null ? `${r.distance_km} km` : "— km"}</span>
                    <span className={`rounded-full px-1.5 py-0.5 font-bold ${r.is_online ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{r.is_online ? "Free" : "Offline"}</span>
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>

      {isCancelled && cancelFee ? (
        <p className="mt-3 rounded-[10px] bg-muted px-3 py-2 text-[12px] text-foreground">
          Cancellation fee ₹{cancelFee.feeBase} + GST ₹{cancelFee.feeGst} · Refund to customer ₹{cancelFee.refund} · Rider share ₹{cancelFee.riderShare}
        </p>
      ) : null}
      {order.stopsFee > 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Extra stops fee: <span className="font-semibold text-foreground">₹{order.stopsFee}</span>
        </p>
      ) : null}

      <MultiStopSections order={order} fetchStops={fetchStops} onChanged={onChanged} />

      {panel === "history" && (
        <div className="mt-3 rounded-[12px] border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
              <History size={14} className="text-primary" /> Event history
            </div>
            <button onClick={() => setPanel(null)} className="text-[12px] font-semibold text-muted-foreground">Close</button>
          </div>
          <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
            {(events ?? []).map((ev) => (
              <div key={ev.id} className="text-[12px]">
                <span className="font-semibold text-foreground">{ev.from_status ? `${ev.from_status} → ` : ""}{ev.to_status}</span>
                <span className="ml-2 text-muted-foreground">{new Date(ev.created_at).toLocaleString()} · {ev.actor_type ?? "system"}</span>
              </div>
            ))}
            {(events ?? []).length === 0 ? <p className="text-[12px] text-muted-foreground">No events yet.</p> : null}
          </div>
        </div>
      )}

      {canWrite ? (
        <div className="mt-3 space-y-3">
          {panel === "cancel" && <div className="rounded-[12px] border border-destructive/40 p-3">
            <h4 className="text-[13px] font-bold text-foreground">Cancel order (reason required)</h4>
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
          </div>}

          {panel === "refund" && <div className="rounded-[12px] border border-border p-3">
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
          </div>}

          {order.status === "FAILED_DELIVERY" && panel === "resolve" ? (
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

const STOP_TYPE_LABEL: Record<string, string> = { pickup: "Pickup", drop: "Drop", return: "Return" };
function toneFor(st: string): "ok" | "warn" | "info" | "off" {
  if (["completed", "delivered", "returned", "paid", "waived"].includes(st)) return "ok";
  if (["failed", "cancelled", "pending"].includes(st)) return st === "pending" ? "off" : "warn";
  return "info";
}
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).replace(/_/g, " ");
const fmt = (t: string | null) => (t ? new Date(t).toLocaleString() : null);

function MultiStopSections({
  order,
  fetchStops,
  onChanged,
}: {
  order: CourierOrderRow;
  fetchStops: ReturnType<typeof useServerFn<typeof getCourierOrderStops>>;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const waive = useServerFn(waiveCourierCharge);
  const verify = useServerFn(verifyCourierStop);
  const skipScan = useServerFn(skipCourierStopScan);
  const [skipFor, setSkipFor] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["courier", "stops", order.id],
    queryFn: () => fetchStops({ data: { orderId: order.id } }),
    refetchInterval: 15_000,
  });
  const [waiveFor, setWaiveFor] = useState<string | null>(null);
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const stops = data?.stops ?? [];
  const parcels = data?.parcels ?? [];
  const charges = data?.charges ?? [];
  const packets = data?.packets ?? [];
  function scanCount(st: { id: string; stop_type: string }) {
    if (packets.length === 0) return null;
    if (st.stop_type === "pickup") {
      return { label: "pickup", done: packets.filter((k) => k.scanned_pickup_at).length, total: packets.length };
    }
    if (st.stop_type === "drop") {
      const mine = packets.filter((k) => k.drop_stop_id === st.id);
      if (mine.length === 0) return null;
      return { label: "drop", done: mine.filter((k) => k.scanned_drop_at).length, total: mine.length };
    }
    return null;
  }
  const pickupIdx = new Map(stops.filter((x) => x.stop_type === "pickup").map((x, i) => [x.id, i + 1]));
  const dropIdx = new Map(stops.filter((x) => x.stop_type === "drop").map((x, i) => [x.id, i + 1]));

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setWaiveFor(null);
      setVerifyFor(null);
      setSkipFor(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["courier", "stops", order.id] });
      qc.invalidateQueries({ queryKey: ["courier", "events", order.id] });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  return (
    <div className="mt-4 space-y-4">
      <TripLeftBehind courierOrderId={order.id} />
      <div className="rounded-[12px] border border-border p-3">
        <h4 className="text-[13px] font-bold text-foreground">Route</h4>
        <div className="mt-2 space-y-2">
          {stops.map((st, i) => (
            <div
              key={st.id}
              className={`rounded-[10px] border p-2.5 text-[12px] ${st.status === "arrived" ? "border-primary bg-primary/10" : "border-border"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-foreground">
                  {i + 1}. {STOP_TYPE_LABEL[st.stop_type] ?? cap(st.stop_type)}
                </span>
                <Pill tone={toneFor(st.status)}>{cap(st.status)}</Pill>
              </div>
              <p className="mt-1 text-muted-foreground">{st.address ?? "—"}</p>
              <p className="text-muted-foreground">
                {st.contact_name ?? "—"} {st.contact_phone ? `· ${st.contact_phone}` : ""}
              </p>
              <p className="text-muted-foreground">
                {[
                  fmt(st.arrived_at) && `Arrived ${fmt(st.arrived_at)}`,
                  fmt(st.completed_at) && `Completed ${fmt(st.completed_at)}`,
                  fmt(st.failed_at) && `Failed ${fmt(st.failed_at)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {st.fail_reason_code ? (
                <p className="font-semibold text-warning">Reason: {cap(st.fail_reason_code)}</p>
              ) : null}
              {st.stop_type === "drop" && st.status === "completed" && scanCount(st) ? <StopProofs stopId={st.id} /> : null}
              {(() => {
                const sc = scanCount(st);
                if (!sc) return null;
                return (
                  <div className="mt-1">
                    <p className={`font-semibold ${sc.done >= sc.total ? "text-primary" : "text-foreground"}`}>
                      Packets scanned at {sc.label}: {sc.done} / {sc.total}
                    </p>
                    {sc.done < sc.total ? (
                      skipFor === st.id ? (
                        <div className="mt-2 space-y-2">
                          <input
                            placeholder="Reason for skipping scan"
                            className={inputCls}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button
                              disabled={busy || !reason.trim()}
                              onClick={() => {
                                if (!window.confirm("Skip packet scanning for this stop?")) return;
                                act(() => skipScan({ data: { stopId: st.id, reason } }), "Scan skipped");
                              }}
                              className="rounded-[10px] bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
                            >
                              Confirm skip
                            </button>
                            <button onClick={() => setSkipFor(null)} className="rounded-[10px] border border-border px-3 py-1.5 text-[12px]">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setSkipFor(st.id);
                            setVerifyFor(null);
                            setWaiveFor(null);
                            setReason("");
                          }}
                          className="mt-2 rounded-[10px] border border-primary px-3 py-1.5 text-[12px] font-bold text-primary"
                        >
                          Skip scan
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })()}
              {st.status === "arrived" ? (
                verifyFor === st.id ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-[11px] font-semibold text-warning">
                      Only use this after confirming by phone with the contact.
                    </p>
                    <input
                      placeholder="Reason (min 10 characters)"
                      className={inputCls}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={busy || reason.trim().length < 10}
                        onClick={() => {
                          if (!window.confirm("Only use this after confirming by phone with the contact. Verify this stop?")) return;
                          act(() => verify({ data: { stopId: st.id, reason } }), "Stop verified");
                        }}
                        className="rounded-[10px] bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
                      >
                        Confirm verify
                      </button>
                      <button onClick={() => setVerifyFor(null)} className="rounded-[10px] border border-border px-3 py-1.5 text-[12px]">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setVerifyFor(st.id);
                      setWaiveFor(null);
                      setReason("");
                    }}
                    className="mt-2 rounded-[10px] border border-primary px-3 py-1.5 text-[12px] font-bold text-primary"
                  >
                    Verify manually
                  </button>
                )
              ) : null}
            </div>
          ))}
          {stops.length === 0 ? <p className="text-[12px] text-muted-foreground">No stops recorded.</p> : null}
        </div>
      </div>

      <div className="rounded-[12px] border border-border p-3">
        <h4 className="text-[13px] font-bold text-foreground">Parcels</h4>
        <div className="mt-2 space-y-1.5">
          {parcels.map((pc) => (
            <div key={pc.id} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold text-foreground">
                Pickup {pickupIdx.get(pc.pickup_stop_id ?? "") ?? "?"} → Drop {dropIdx.get(pc.drop_stop_id ?? "") ?? "?"}
              </span>
              <span className="text-muted-foreground">{pc.description ?? ""}</span>
              <Pill tone={toneFor(pc.status)}>{cap(pc.status)}</Pill>
            </div>
          ))}
          {parcels.length === 0 ? <p className="text-[12px] text-muted-foreground">No parcels recorded.</p> : null}
        </div>
      </div>

      {charges.length > 0 ? (
        <div className="rounded-[12px] border border-border p-3">
          <h4 className="text-[13px] font-bold text-foreground">Charges</h4>
          <div className="mt-2 space-y-2">
            {charges.map((c) => (
              <div key={c.id} className="rounded-[10px] border border-border p-2.5 text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-foreground">{cap(c.charge_type)}</span>
                  <Pill tone={toneFor(c.status)}>{cap(c.status)}</Pill>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {c.distance_km} km · ₹{c.amount} + GST ₹{c.gst_amount} = <span className="font-semibold text-foreground">₹{c.total_amount}</span>
                  {c.paid_at ? ` · Paid ${fmt(c.paid_at)}` : ""}
                  {c.razorpay_payment_id ? ` · ${c.razorpay_payment_id}` : ""}
                </p>
                {c.status === "pending" ? (
                  waiveFor === c.id ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        placeholder="Reason"
                        className={`${inputCls} max-w-xs`}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <button
                        disabled={busy || !reason.trim()}
                        onClick={() => {
                          if (!window.confirm(`Waive ₹${c.total_amount} return charge?`)) return;
                          act(() => waive({ data: { chargeId: c.id, reason } }), "Charge waived");
                        }}
                        className="rounded-[10px] bg-destructive px-3 py-1.5 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
                      >
                        Confirm waive
                      </button>
                      <button onClick={() => setWaiveFor(null)} className="rounded-[10px] border border-border px-3 py-1.5 text-[12px]">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setWaiveFor(c.id);
                        setVerifyFor(null);
                        setReason("");
                      }}
                      className="mt-2 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-bold text-foreground hover:bg-muted"
                    >
                      Waive
                    </button>
                  )
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OrdersTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchOrders = useServerFn(listCourierOrders);
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [multiStop, setMultiStop] = useState(false);
  const [business, setBusiness] = useState("");
  const [selected, setSelected] = useState<CourierOrderRow | null>(null);
  const fetchBiz = useServerFn(listBusinesses);
  const { data: bizList } = useQuery({
    queryKey: ["bulk", "businesses"],
    queryFn: () => fetchBiz(),
    staleTime: 60_000,
  });

  const { data } = useQuery({
    queryKey: ["courier", "orders", status, search, multiStop, business],
    queryFn: () =>
      fetchOrders({
        data: { status: status || null, search: search || null, multiStop, businessId: business || null },
      }),
    refetchInterval: 30_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["courier", "orders"] });
  // Opened from a bell alert: open that exact order/trip once the list has it.
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const id = sessionStorage.getItem("cc-open-courier");
        if (id) { sessionStorage.removeItem("cc-open-courier"); setPendingOpen(id); setStatus(""); setSearch(""); setBusiness(""); setMultiStop(false); }
      } catch { /* ignore */ }
    };
    read();
    window.addEventListener("cc-open-courier", read);
    return () => window.removeEventListener("cc-open-courier", read);
  }, []);
  useEffect(() => {
    if (!pendingOpen || !data) return;
    const hit = data.find((o) => o.id === pendingOpen);
    if (hit) { setSelected(hit); setPendingOpen(null); }
  }, [pendingOpen, data]);

  const [range, setRange] = useState<"all" | "today" | "yesterday" | "7d" | "30d" | "custom">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<"code" | "customer" | "rider" | "stops" | "amount" | "status" | "placed">("placed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const rows = useMemo(() => {
    const day = 86_400_000;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    let lo = -Infinity, hi = Infinity;
    if (range === "today") lo = start.getTime();
    else if (range === "yesterday") { lo = start.getTime() - day; hi = start.getTime(); }
    else if (range === "7d") lo = start.getTime() - 6 * day;
    else if (range === "30d") lo = start.getTime() - 29 * day;
    else if (range === "custom") {
      if (from) lo = new Date(from + "T00:00:00").getTime();
      if (to) hi = new Date(to + "T00:00:00").getTime() + day;
    }
    const val = (o: CourierOrderRow): string | number => {
      switch (sortKey) {
        case "code": return o.order_code ?? "";
        case "customer": return (o.customerName ?? "").toLowerCase();
        case "rider": return (o.riderName ?? "").toLowerCase();
        case "stops": return (o.pickup_count ?? 0) + (o.drop_count ?? 0);
        case "amount": return Number(o.total_amount ?? 0);
        case "status": return String(o.status);
        default: return new Date(o.created_at).getTime();
      }
    };
    return (data ?? [])
      .filter((o) => { const t = new Date(o.created_at).getTime(); return t >= lo && t < hi; })
      .sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sortDir === "asc" ? c : -c; });
  }, [data, range, from, to, sortKey, sortDir]);
  const th = (k: typeof sortKey, label: string, right = false) => (
    <th className={`px-3 py-2.5 ${right ? "text-right" : ""}`}>
      <button
        onClick={() => { if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir(k === "placed" || k === "amount" ? "desc" : "asc"); } }}
        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
      >
        {label}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  const typeVal = multiStop ? "multi" : business === "any" ? "business" : business ? business : "";

  return (
    <div className="space-y-6">
      <FilterBar count={countLabel(rows.length, "order")}>
        <FilterField label="Search"><input
          placeholder="Search code, customer, phone"
          className={`${filterInputCls} min-w-[230px]`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        /></FilterField>
        <FilterField label="Status"><select
          className={`${filterSelectCls}`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {COURIER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select></FilterField>
        <FilterField label="Type"><select
          className={`${filterSelectCls}`}
          value={typeVal}
          onChange={(e) => {
            const v = e.target.value;
            setMultiStop(v === "multi");
            setBusiness(v === "business" ? "any" : v === "" || v === "multi" ? "" : v);
          }}
        >
          <option value="">All types</option>
          <option value="multi">Multi-stop</option>
          <option value="business">Business (all)</option>
          {(bizList ?? []).map((b) => (
            <option key={b.merchant_id} value={b.merchant_id}>
              {`Business · ${b.business_name}`}
            </option>
          ))}
        </select></FilterField>
        <FilterField label="Date"><select className={`${filterSelectCls}`} value={range} onChange={(e) => setRange(e.target.value as typeof range)}>
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range</option>
        </select></FilterField>
        {range === "custom" ? (
          <>
            <FilterField label="From"><input type="date" className={filterInputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></FilterField>
            <FilterField label="To"><input type="date" className={filterInputCls} value={to} onChange={(e) => setTo(e.target.value)} /></FilterField>
          </>
        ) : null}
      </FilterBar>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No courier orders found.</p>
      ) : (
        <div className="overflow-x-auto rounded-[18px] border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40">
              <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {th("code", "Code")}
                {th("customer", "Customer")}
                {th("rider", "Rider")}
                {th("stops", "Stops")}
                {th("amount", "Amount", true)}
                {th("status", "Status")}
                {th("placed", "Placed")}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const cancelled = String(o.status).toLowerCase().includes("cancel");
                const refunded = (o.refund_status ?? "none") !== "none";
                return (
                  <tr
                    key={o.id}
                    onClick={() => setSelected(o)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2.5 font-bold text-foreground">
                      {o.order_code}
                      {o.businessName ? <div className="text-[11px] font-normal text-muted-foreground">{o.businessName}</div> : null}
                    </td>
                    <td className="px-3 py-2.5 text-foreground">{o.customerName ?? "Customer"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{o.riderName ?? "No rider"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{`${o.pickup_count}P · ${o.drop_count}D`}</td>
                    <td className="px-3 py-2.5 text-right">
                      {cancelled && !refunded ? (
                        <span className="text-muted-foreground">—</span>
                      ) : cancelled ? (
                        <span className="text-muted-foreground">Refund {o.refund_status}</span>
                      ) : (
                        <OrderPaymentSummary
                          className="text-right"
                          paid={String(o.payment_status ?? "").toLowerCase() === "paid" ? o.total_amount : 0}
                          base={o.base_amount}
                          coupon={o.discount_amount}
                          gst={o.gst_amount}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <Pill tone={toneFor(o.status)}>{o.status}</Pill>
                        {o.needs_ops_attention ? <Pill tone="warn">Needs attention</Pill> : null}
                        {o.returnPaymentPending ? <Pill tone="warn">Return pending</Pill> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {new Date(o.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

/* ----------------------------- Zone mapping ------------------------------ */

function ZoneMappingTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchMapping = useServerFn(listCourierZoneMapping);
  const save = useServerFn(saveCourierZoneMapping);
  const [city, setCity] = useState<string>("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ["courier", "zone-mapping"],
    queryFn: () => fetchMapping(),
  });

  const cities = data?.cities ?? [];
  const activeCity = city || cities[0] || "";
  const cityZones = useMemo(
    () =>
      (data?.zones ?? []).filter(
        (z) => z.city.toLowerCase() === activeCity.toLowerCase() && activeCity !== "",
      ),
    [data, activeCity],
  );

  const current = selected ?? cityZones.filter((z) => z.mapped).map((z) => z.id);
  const dirty =
    selected !== null &&
    JSON.stringify([...current].sort()) !==
      JSON.stringify(
        cityZones
          .filter((z) => z.mapped)
          .map((z) => z.id)
          .sort(),
      );

  function toggleZone(id: string) {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setSelected(next);
  }

  async function submit() {
    setBusy(true);
    try {
      await save({ data: { city: activeCity, zoneIds: current } });
      toast.success("Zone mapping saved");
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["courier", "zone-mapping"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-info/30 bg-info/10 p-4 text-[12px] text-foreground">
        Parcel delivery runs only inside the zones you map here, and only within the same city —
        pickup and drop must both fall in a mapped zone of that city. If a city has no mapped zone,
        courier stays off there.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-semibold text-muted-foreground">City</span>
        <select
          value={activeCity}
          onChange={(e) => {
            setCity(e.target.value);
            setSelected(null);
          }}
          className="rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-foreground"
        >
          {cities.length === 0 ? <option value="">No cities</option> : null}
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {canWrite && cityZones.length > 0 ? (
          <>
            <button
              onClick={() => setSelected(cityZones.map((z) => z.id))}
              className="rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted"
            >
              Select all
            </button>
            <button
              onClick={() => setSelected([])}
              className="rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>

      {cityZones.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No active zones in this city yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {cityZones.map((z) => {
            const on = current.includes(z.id);
            return (
              <label
                key={z.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-[16px] border p-4 ${
                  on ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                } ${canWrite ? "" : "cursor-default opacity-80"}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canWrite}
                    onChange={() => toggleZone(z.id)}
                    className="h-4 w-4 accent-[#00B97A]"
                  />
                  <span className="text-[13px] font-bold text-foreground">{z.name}</span>
                </span>
                {on ? <Pill tone="ok">Mapped</Pill> : <Pill tone="off">Not mapped</Pill>}
              </label>
            );
          })}
        </div>
      )}

      {canWrite ? (
        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!dirty || busy || !activeCity}
            className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save mapping"}
          </button>
          {dirty ? (
            <button
              onClick={() => setSelected(null)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Reset
            </button>
          ) : null}
          <span className="text-[12px] text-muted-foreground">
            {current.length} of {cityZones.length} zones mapped
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- page ---------------------------------- */

export function CourierPage({ section = "orders" }: { section?: CourierSection }) {
  const fetchAccess = useServerFn(getCourierAccess);

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
      {!canWrite && section !== "bulk" ? (
        <div className="rounded-[12px] border border-border bg-muted px-4 py-2 text-[12px] text-muted-foreground">
          Read-only access — only a super admin can change courier settings.
        </div>
      ) : null}

      {section === "types" ? (
        <div className="space-y-8">
          <section><h2 className="mb-3 text-[15px] font-bold text-foreground">Vehicles</h2><VehicleTypesTab canWrite={canWrite} /></section>
          <section><h2 className="mb-3 text-[15px] font-bold text-foreground">Parcel types</h2><CourierTypesTab canWrite={canWrite} /></section>
        </div>
      ) : null}
      {section === "rates" ? (<RatesTab canWrite={canWrite} />) : null}
      {section === "riders" ? <div className="space-y-6"><ExpertsPage role={access?.role === "super_admin" || access?.role === "ops_manager" ? access.role : null} skill="rider" /></div> : null}
      {section === "settings" ? (
        <div className="space-y-8">
          <SettingsSection title="Operating hours & holidays">
            <ServiceHoursPanel serviceKey="courier" title="Parcel timings" />
          </SettingsSection>
          <SettingsSection title="Operational rules">
            <CourierSettingsCard canEdit={canWrite} />
            <CancelFeeCard />
          </SettingsSection>
          <SettingsSection title="Service area">
            <ZoneMappingTab canWrite={canWrite} />
          </SettingsSection>
          <SettingsSection title="Notify-Me (last 7 days)">
            <NotifyStatsCard services={["parcel"]} reason="riders_busy" title="Customers who asked to be notified" />
          </SettingsSection>
        </div>
      ) : null}
      {section === "orders" ? <OrdersTab canWrite={canWrite} /> : null}
      {section === "bulk" ? <BulkCourierPage canWriteOrders={canWrite} /> : null}
    </div>
  );
}
