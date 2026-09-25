import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus, X } from "lucide-react";
import {
  assignBusinessPlans,
  businessDispatchNow,
  businessWalletAdjust,
  createBusiness,
  getBulkAccess,
  getBusinessDetail,
  listBulkPlans,
  listBusinesses,
  saveBusinessDefaults,
  saveDispatchPlan,
  savePickupPoint,
  savePricingPlan,
  setBusinessDeliveryStatus,
  setBusinessModules,
  setPlanActive,
  type BusinessRow,
  type DispatchPlan,
  type PickupPoint,
  type PricingPlan,
} from "@/lib/bulk-courier.functions";
import { listCourierOrders, type CourierOrderRow } from "@/lib/courier.functions";
import { Field, Modal, OrderDetail, Pill, inputCls } from "@/components/courier-page";

const btn = "rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-40";
const btnGhost = "rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-40";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground";
const td = "px-3 py-2 text-[13px] text-foreground";
const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function Tabs<T extends string>({ items, value, onChange }: { items: ReadonlyArray<{ key: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <button key={i.key} onClick={() => onChange(i.key)}
          className={`rounded-[10px] px-3.5 py-2 text-[12px] font-semibold ${value === i.key ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted"}`}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
      <table className="w-full">
        <thead className="border-b border-border bg-muted/40"><tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function ReasonDialog({ title, body, confirmLabel, onClose, onConfirm }: { title: string; body?: React.ReactNode; confirmLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        {body}
        <Field label="Reason (required)"><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btn} disabled={!reason.trim() || busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); onClose(); } catch (e) { err(e); } finally { setBusy(false); } }}>{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- plans ------------------------------- */

function useActiveToggle() {
  const qc = useQueryClient();
  const fn = useServerFn(setPlanActive);
  return async (kind: "pricing" | "dispatch", id: string, active: boolean) => {
    if (!active && !window.confirm("Deactivate this plan?")) return;
    try {
      const r = await fn({ data: { kind, id, active } });
      if (!r.ok) {
        toast.error(r.reason === "in_use" ? `In use by ${r.used_by} active business${r.used_by === 1 ? "" : "es"}. Move them to another plan first.` : "Could not change plan");
        return;
      }
      toast.success(active ? "Plan activated" : "Plan deactivated");
      qc.invalidateQueries({ queryKey: ["bulk"] });
    } catch (e) { err(e); }
  };
}

const emptyPricing = { id: null as string | null, name: "", base_fare: 0, included_km: 0, per_km: 0, min_fare: 0, extra_drop_fee: 0, return_per_km: 0, commission_pct: 0, is_active: true };

function PricingPlansTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchPlans = useServerFn(listBulkPlans);
  const save = useServerFn(savePricingPlan);
  const toggle = useActiveToggle();
  const { data } = useQuery({ queryKey: ["bulk", "plans"], queryFn: () => fetchPlans() });
  const [edit, setEdit] = useState<(typeof emptyPricing & { id: string | null; used_by?: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const nums: Array<[keyof typeof emptyPricing, string]> = [["base_fare", "Base fare ₹"], ["included_km", "Included km"], ["per_km", "Per km ₹"], ["min_fare", "Min fare ₹"], ["extra_drop_fee", "Extra drop fee ₹"], ["return_per_km", "Return ₹/km"], ["commission_pct", "Commission %"]];
  return (
    <div className="space-y-3">
      {canWrite ? <button className={btn} onClick={() => setEdit({ ...emptyPricing })}><Plus size={14} className="mr-1 inline" />Pricing plan</button> : null}
      <Table head={["Name", "Base", "Incl. km", "Per km", "Min fare", "Extra drop", "Return ₹/km", "Comm. %", "Used by", "Active", ""]}>
        {(data?.pricing ?? []).map((p: PricingPlan) => (
          <tr key={p.id}>
            <td className={`${td} font-semibold`}>{p.name}</td><td className={td}>{inr(p.base_fare)}</td><td className={td}>{p.included_km}</td>
            <td className={td}>{inr(p.per_km)}</td><td className={td}>{inr(p.min_fare)}</td><td className={td}>{inr(p.extra_drop_fee)}</td>
            <td className={td}>{inr(p.return_per_km)}</td><td className={td}>{p.commission_pct}%</td><td className={td}>{p.used_by}</td>
            <td className={td}><input type="checkbox" className="h-4 w-4 accent-[#00B97A]" checked={p.is_active} disabled={!canWrite} onChange={(e) => toggle("pricing", p.id, e.target.checked)} /></td>
            <td className={td}>{canWrite ? <button className={btnGhost} onClick={() => setEdit({ ...p })}><Pencil size={12} /></button> : null}</td>
          </tr>
        ))}
      </Table>
      {(data?.pricing ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">No pricing plans yet.</p> : null}
      {edit ? (
        <Modal title={edit.id ? "Edit pricing plan" : "New pricing plan"} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            {edit.id ? <div className="rounded-[10px] bg-info/10 p-3 text-[12px] text-foreground">Used by {edit.used_by ?? 0} businesses. Changes apply to new trips only.</div> : null}
            <Field label="Name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              {nums.map(([k, l]) => (
                <Field key={k} label={l}><input type="number" min={0} className={inputCls} value={String(edit[k] ?? 0)} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} /></Field>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button>
              <button className={btn} disabled={busy || !edit.name.trim()} onClick={async () => {
                setBusy(true);
                try { const { used_by: _u, ...rest } = edit; void _u; await save({ data: rest }); toast.success("Pricing plan saved"); setEdit(null); qc.invalidateQueries({ queryKey: ["bulk"] }); } catch (e) { err(e); } finally { setBusy(false); }
              }}>Save</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

const emptyDispatch = { id: null as string | null, name: "", manual_enabled: false, qty_enabled: false, qty_threshold: 10 as number | null, slots_enabled: false, slot_times: [] as string[], max_drops_per_batch: null as number | null, is_active: true };

function DispatchPlansTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchPlans = useServerFn(listBulkPlans);
  const save = useServerFn(saveDispatchPlan);
  const toggle = useActiveToggle();
  const { data } = useQuery({ queryKey: ["bulk", "plans"], queryFn: () => fetchPlans() });
  const [edit, setEdit] = useState<(typeof emptyDispatch & { used_by?: number }) | null>(null);
  const [maxOn, setMaxOn] = useState(false);
  const [slot, setSlot] = useState("");
  const [busy, setBusy] = useState(false);
  const open = (p: typeof emptyDispatch & { used_by?: number }) => { setEdit(p); setMaxOn(!!p.max_drops_per_batch); setSlot(""); };
  const valid = edit && edit.name.trim() && (edit.manual_enabled || edit.qty_enabled || (edit.slots_enabled && edit.slot_times.length > 0) || (maxOn && (edit.max_drops_per_batch ?? 0) > 0));
  return (
    <div className="space-y-3">
      {canWrite ? <button className={btn} onClick={() => open({ ...emptyDispatch })}><Plus size={14} className="mr-1 inline" />Dispatch plan</button> : null}
      <Table head={["Name", "Manual", "Min qty", "Time slots (IST)", "Max drops/trip", "Used by", "Active", ""]}>
        {(data?.dispatch ?? []).map((p: DispatchPlan) => (
          <tr key={p.id}>
            <td className={`${td} font-semibold`}>{p.name}</td>
            <td className={td}>{p.manual_enabled ? "Yes" : "—"}</td>
            <td className={td}>{p.qty_enabled ? p.qty_threshold : "—"}</td>
            <td className={td}>{p.slots_enabled && p.slot_times.length ? p.slot_times.join(", ") : "—"}</td>
            <td className={td}>{p.max_drops_per_batch ?? "—"}</td>
            <td className={td}>{p.used_by}</td>
            <td className={td}><input type="checkbox" className="h-4 w-4 accent-[#00B97A]" checked={p.is_active} disabled={!canWrite} onChange={(e) => toggle("dispatch", p.id, e.target.checked)} /></td>
            <td className={td}>{canWrite ? <button className={btnGhost} onClick={() => open({ ...p })}><Pencil size={12} /></button> : null}</td>
          </tr>
        ))}
      </Table>
      {(data?.dispatch ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">No dispatch plans yet.</p> : null}
      {edit ? (
        <Modal title={edit.id ? "Edit dispatch plan" : "New dispatch plan"} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            {edit.id ? <div className="rounded-[10px] bg-info/10 p-3 text-[12px] text-foreground">Used by {edit.used_by ?? 0} businesses. Changes apply to new trips only.</div> : null}
            <Field label="Name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.manual_enabled} onChange={(e) => setEdit({ ...edit, manual_enabled: e.target.checked })} />Manual dispatch</label>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.qty_enabled} onChange={(e) => setEdit({ ...edit, qty_enabled: e.target.checked })} />Min qty
              <input type="number" min={1} disabled={!edit.qty_enabled} className={`${inputCls} max-w-[100px]`} value={edit.qty_threshold ?? ""} onChange={(e) => setEdit({ ...edit, qty_threshold: Number(e.target.value) || null })} /></label>
            <div>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.slots_enabled} onChange={(e) => setEdit({ ...edit, slots_enabled: e.target.checked })} />Time slots (IST)</label>
              {edit.slots_enabled ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                  {edit.slot_times.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary">{t}
                      <button onClick={() => setEdit({ ...edit, slot_times: edit.slot_times.filter((x) => x !== t) })}><X size={12} /></button></span>
                  ))}
                  <input type="time" className={`${inputCls} max-w-[130px]`} value={slot} onChange={(e) => setSlot(e.target.value)} />
                  <button className={btnGhost} disabled={!slot} onClick={() => { if (!edit.slot_times.includes(slot)) setEdit({ ...edit, slot_times: [...edit.slot_times, slot].sort() }); setSlot(""); }}>Add</button>
                </div>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={maxOn} onChange={(e) => { setMaxOn(e.target.checked); if (!e.target.checked) setEdit({ ...edit, max_drops_per_batch: null }); }} />Max drops per trip
              <input type="number" min={1} disabled={!maxOn} className={`${inputCls} max-w-[100px]`} value={edit.max_drops_per_batch ?? ""} onChange={(e) => setEdit({ ...edit, max_drops_per_batch: Number(e.target.value) || null })} /></label>
            {!valid ? <p className="text-[12px] text-warning">Enter a name and tick at least one option.</p> : null}
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button>
              <button className={btn} disabled={busy || !valid} onClick={async () => {
                setBusy(true);
                try { const { used_by: _u, ...rest } = edit; void _u; await save({ data: { ...rest, max_drops_per_batch: maxOn ? rest.max_drops_per_batch : null } as never }); toast.success("Dispatch plan saved"); setEdit(null); qc.invalidateQueries({ queryKey: ["bulk"] }); } catch (e) { err(e); } finally { setBusy(false); }
              }}>Save</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------ businesses ------------------------------ */

const lowBal = (b: BusinessRow) => b.wallet_balance < 0 || b.wallet_balance < b.low_balance_threshold;

function BusinessesTab({ canWrite, canOperate, canWriteOrders }: { canWrite: boolean; canOperate: boolean; canWriteOrders: boolean }) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listBusinesses);
  const create = useServerFn(createBusiness);
  const { data, isLoading } = useQuery({ queryKey: ["bulk", "businesses"], queryFn: () => fetchList(), refetchInterval: 60_000 });
  const [adding, setAdding] = useState<{ phone: string; business_name: string; city: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = (data ?? []).find((b) => b.merchant_id === openId) ?? null;
  return (
    <div className="space-y-3">
      {canWrite ? <button className={btn} onClick={() => setAdding({ phone: "", business_name: "", city: "Latur" })}><Plus size={14} className="mr-1 inline" />Add business</button> : null}
      {isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      <Table head={["Business", "Phone", "City", "Delivery", "Pricing plan", "Dispatch plan", "Wallet", "Pending", "Trips today"]}>
        {(data ?? []).map((b) => (
          <tr key={b.merchant_id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(b.merchant_id)}>
            <td className={`${td} font-semibold`}>{b.business_name}{!b.pricing_plan_id || !b.dispatch_plan_id ? <span className="ml-2"><Pill tone="warn">No plans</Pill></span> : null}</td>
            <td className={td}>{b.phone ?? "—"}</td><td className={td}>{b.city ?? "—"}</td>
            <td className={td}><Pill tone={b.delivery_status === "active" ? "ok" : "off"}>{b.delivery_status ?? "—"}</Pill></td>
            <td className={td}>{b.pricing_plan ?? "—"}</td><td className={td}>{b.dispatch_plan ?? "—"}</td>
            <td className={`${td} font-semibold ${lowBal(b) ? "text-destructive" : ""}`}>{inr(b.wallet_balance)}</td>
            <td className={td}>{b.pending_orders}</td><td className={td}>{b.trips_today}</td>
          </tr>
        ))}
      </Table>
      {!isLoading && (data ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">No businesses yet.</p> : null}
      {adding ? (
        <Modal title="Add business" onClose={() => setAdding(null)}>
          <div className="space-y-3">
            <Field label="Phone"><input className={inputCls} value={adding.phone} onChange={(e) => setAdding({ ...adding, phone: e.target.value })} /></Field>
            <Field label="Business name"><input className={inputCls} value={adding.business_name} onChange={(e) => setAdding({ ...adding, business_name: e.target.value })} /></Field>
            <Field label="City"><input className={inputCls} value={adding.city} onChange={(e) => setAdding({ ...adding, city: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setAdding(null)}>Cancel</button>
              <button className={btn} disabled={busy || !adding.phone.trim() || !adding.business_name.trim() || !adding.city.trim()} onClick={async () => {
                setBusy(true);
                try { const r = await create({ data: adding }); toast.success("Business created"); setAdding(null); await qc.invalidateQueries({ queryKey: ["bulk", "businesses"] }); setOpenId(r.merchantId); } catch (e) { err(e); } finally { setBusy(false); }
              }}>Create</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {selected ? <BusinessDetail biz={selected} canWrite={canWrite} canOperate={canOperate} canWriteOrders={canWriteOrders} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

type DTab = "setup" | "receivers" | "orders" | "trips" | "wallet";

function BusinessDetail({ biz, canWrite, canOperate, canWriteOrders, onClose }: { biz: BusinessRow; canWrite: boolean; canOperate: boolean; canWriteOrders: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getBusinessDetail);
  const { data } = useQuery({ queryKey: ["bulk", "detail", biz.merchant_id], queryFn: () => fetchDetail({ data: { merchant_id: biz.merchant_id } }), refetchInterval: 30_000 });
  const [tab, setTab] = useState<DTab>("setup");
  const refresh = () => qc.invalidateQueries({ queryKey: ["bulk"] });
  return (
    <Modal title={biz.business_name} onClose={onClose} wide>
      <div className="space-y-4">
        <Tabs value={tab} onChange={setTab} items={[{ key: "setup", label: "Setup" }, { key: "receivers", label: "Receivers" }, { key: "orders", label: "Orders" }, { key: "trips", label: "Trips" }, { key: "wallet", label: "Wallet" }] as const} />
        {!data ? <p className="text-[13px] text-muted-foreground">Loading…</p> : tab === "setup" ? (
          <SetupTab biz={biz} canWrite={canWrite} canOperate={canOperate} pickups={data.pickups} vehicleTypes={data.vehicleTypes} courierTypes={data.courierTypes} onChanged={refresh} />
        ) : tab === "receivers" ? <ReceiversTab rows={data.receivers} />
          : tab === "orders" ? <BizOrdersTab biz={biz} canWrite={canOperate} rows={data.orders} receivers={data.receivers} onChanged={refresh} />
          : tab === "trips" ? <TripsTab rows={data.trips} canWriteOrders={canWriteOrders} />
          : <WalletTab biz={biz} canWrite={canWrite} ledger={data.ledger} topups={data.topups} onChanged={refresh} />}
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="space-y-2 rounded-[14px] border border-border p-4"><h4 className="text-[13px] font-bold text-foreground">{title}</h4>{children}</div>;
}

function SetupTab({ biz, canWrite, canOperate, pickups, vehicleTypes, courierTypes, onChanged }: { biz: BusinessRow; canWrite: boolean; canOperate: boolean; pickups: PickupPoint[]; vehicleTypes: Array<{ id: string; name: string }>; courierTypes: Array<{ id: string; name: string }>; onChanged: () => void }) {
  const fetchPlans = useServerFn(listBulkPlans);
  const setModules = useServerFn(setBusinessModules);
  const setStatus = useServerFn(setBusinessDeliveryStatus);
  const assign = useServerFn(assignBusinessPlans);
  const saveDefaults = useServerFn(saveBusinessDefaults);
  const savePp = useServerFn(savePickupPoint);
  const { data: plans } = useQuery({ queryKey: ["bulk", "plans"], queryFn: () => fetchPlans() });
  const [mods, setMods] = useState({ store: biz.store_enabled, delivery: biz.delivery_enabled });
  const [status, setStatusV] = useState(biz.delivery_status ?? "");
  const [pp, setPp] = useState({ pricing: biz.pricing_plan_id ?? "", dispatch: biz.dispatch_plan_id ?? "" });
  const [def, setDef] = useState({ vehicle: biz.vehicle_type_id ?? "", courier: biz.courier_type_id ?? "", low: biz.low_balance_threshold });
  const [reasonFor, setReasonFor] = useState<"modules" | "status" | null>(null);
  const [editPp, setEditPp] = useState<(Omit<PickupPoint, "id"> & { id: string | null }) | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast.success(msg); onChanged(); } catch (e) { err(e); } finally { setBusy(false); } };
  const statuses = ["inactive", "active", "suspended"];
  return (
    <div className="space-y-3">
      <Section title="Modules">
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canWrite} checked={mods.store} onChange={(e) => setMods({ ...mods, store: e.target.checked })} />Store</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canWrite} checked={mods.delivery} onChange={(e) => setMods({ ...mods, delivery: e.target.checked })} />Delivery</label>
          {canWrite ? <button className={btnGhost} disabled={mods.store === biz.store_enabled && mods.delivery === biz.delivery_enabled} onClick={() => setReasonFor("modules")}>Save modules</button> : null}
        </div>
      </Section>
      <Section title="Delivery status">
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${inputCls} max-w-[200px]`} disabled={!canWrite} value={status} onChange={(e) => setStatusV(e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {canWrite ? <button className={btnGhost} disabled={status === (biz.delivery_status ?? "")} onClick={() => setReasonFor("status")}>Change status</button> : null}
        </div>
      </Section>
      <Section title="Plans">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pricing plan"><select className={inputCls} disabled={!canWrite} value={pp.pricing} onChange={(e) => setPp({ ...pp, pricing: e.target.value })}>
            <option value="">— None —</option>{(plans?.pricing ?? []).filter((p) => p.is_active || p.id === biz.pricing_plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? "" : " (inactive)"}</option>)}</select></Field>
          <Field label="Dispatch plan"><select className={inputCls} disabled={!canWrite} value={pp.dispatch} onChange={(e) => setPp({ ...pp, dispatch: e.target.value })}>
            <option value="">— None —</option>{(plans?.dispatch ?? []).filter((p) => p.is_active || p.id === biz.dispatch_plan_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? "" : " (inactive)"}</option>)}</select></Field>
        </div>
        {canWrite ? <button className={btnGhost} disabled={busy} onClick={() => run(() => assign({ data: { merchant_id: biz.merchant_id, pricing_plan_id: pp.pricing || null, dispatch_plan_id: pp.dispatch || null } }), "Plans assigned")}>Save plans</button> : null}
      </Section>
      <Section title="Defaults">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Default vehicle type"><select className={inputCls} disabled={!canOperate} value={def.vehicle} onChange={(e) => setDef({ ...def, vehicle: e.target.value })}><option value="">— None —</option>{vehicleTypes.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="Default courier type"><select className={inputCls} disabled={!canOperate} value={def.courier} onChange={(e) => setDef({ ...def, courier: e.target.value })}><option value="">— None —</option>{courierTypes.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label="Low-balance limit ₹"><input type="number" className={inputCls} disabled={!canOperate} value={def.low} onChange={(e) => setDef({ ...def, low: Number(e.target.value) })} /></Field>
        </div>
        {canOperate ? <button className={btnGhost} disabled={busy} onClick={() => run(() => saveDefaults({ data: { merchant_id: biz.merchant_id, vehicle_type_id: def.vehicle || null, courier_type_id: def.courier || null, low_balance_threshold: def.low } }), "Defaults saved")}>Save defaults</button> : null}
      </Section>
      <Section title="Pickup points">
        {pickups.length === 0 ? <p className="text-[12px] text-muted-foreground">No pickup points.</p> : null}
        {pickups.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-border p-2 text-[13px]">
            <div><span className="font-semibold">{p.name}</span> {p.is_default ? <Pill tone="ok">Default</Pill> : null} {!p.is_active ? <Pill tone="off">Inactive</Pill> : null}
              <p className="text-[12px] text-muted-foreground">{p.address}{p.contact_phone ? ` · ${p.contact_name ?? ""} ${p.contact_phone}` : ""}</p></div>
            {canOperate ? <button className={btnGhost} onClick={() => setEditPp({ ...p })}><Pencil size={12} /></button> : null}
          </div>
        ))}
        {canOperate ? <button className={btnGhost} onClick={() => setEditPp({ id: null, name: "", address: "", lat: null, lng: null, contact_name: "", contact_phone: "", is_default: pickups.length === 0, is_active: true })}><Plus size={12} className="mr-1 inline" />Add pickup point</button> : null}
      </Section>
      {reasonFor ? (
        <ReasonDialog title={reasonFor === "modules" ? "Change modules" : `Set delivery status to "${status}"`} confirmLabel="Save" onClose={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            if (reasonFor === "modules") await setModules({ data: { merchant_id: biz.merchant_id, store_enabled: mods.store, delivery_enabled: mods.delivery, reason } });
            else await setStatus({ data: { merchant_id: biz.merchant_id, status, reason } });
            toast.success("Saved"); onChanged();
          }} />
      ) : null}
      {editPp ? (
        <Modal title={editPp.id ? "Edit pickup point" : "Add pickup point"} onClose={() => setEditPp(null)}>
          <div className="space-y-3">
            <Field label="Name"><input className={inputCls} value={editPp.name} onChange={(e) => setEditPp({ ...editPp, name: e.target.value })} /></Field>
            <Field label="Address"><textarea className={inputCls} rows={2} value={editPp.address} onChange={(e) => setEditPp({ ...editPp, address: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude"><input type="number" className={inputCls} value={editPp.lat ?? ""} onChange={(e) => setEditPp({ ...editPp, lat: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="Longitude"><input type="number" className={inputCls} value={editPp.lng ?? ""} onChange={(e) => setEditPp({ ...editPp, lng: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="Contact name"><input className={inputCls} value={editPp.contact_name ?? ""} onChange={(e) => setEditPp({ ...editPp, contact_name: e.target.value })} /></Field>
              <Field label="Contact phone"><input className={inputCls} value={editPp.contact_phone ?? ""} onChange={(e) => setEditPp({ ...editPp, contact_phone: e.target.value })} /></Field>
            </div>
            <div className="flex gap-4 text-[13px]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={editPp.is_default} onChange={(e) => setEditPp({ ...editPp, is_default: e.target.checked })} />Default</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={editPp.is_active} onChange={(e) => setEditPp({ ...editPp, is_active: e.target.checked })} />Active</label>
            </div>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setEditPp(null)}>Cancel</button>
              <button className={btn} disabled={busy || !editPp.name.trim() || !editPp.address.trim()} onClick={() => run(async () => { await savePp({ data: { ...editPp, merchant_id: biz.merchant_id } }); setEditPp(null); }, "Pickup point saved")}>Save</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ReceiversTab({ rows }: { rows: Array<Record<string, any>> }) {
  const [q, setQ] = useState("");
  const list = rows.filter((r) => !q || [r.name, r.contact_name, r.contact_phone, r.address].some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <input className={`${inputCls} max-w-[280px]`} placeholder="Search receivers" value={q} onChange={(e) => setQ(e.target.value)} />
      <Table head={["Name", "Contact", "Phone", "Address", "Status"]}>
        {list.map((r) => <tr key={r.id}><td className={`${td} font-semibold`}>{r.name}</td><td className={td}>{r.contact_name ?? "—"}</td><td className={td}>{r.contact_phone ?? "—"}</td><td className={td}>{r.address ?? "—"}</td><td className={td}>{r.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Inactive</Pill>}</td></tr>)}
      </Table>
      {list.length === 0 ? <p className="text-[13px] text-muted-foreground">No receivers.</p> : null}
    </div>
  );
}

function BizOrdersTab({ biz, canWrite, rows, receivers, onChanged }: { biz: BusinessRow; canWrite: boolean; rows: Array<Record<string, any>>; receivers: Array<Record<string, any>>; onChanged: () => void }) {
  const dispatch = useServerFn(businessDispatchNow);
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState(false);
  const recMap = useMemo(() => new Map(receivers.map((r) => [r.id, r.name])), [receivers]);
  const statuses = Array.from(new Set(rows.map((r) => r.status as string)));
  const list = rows.filter((r) => !status || r.status === status);
  const pending = rows.filter((r) => r.status === "pending").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputCls} max-w-[200px]`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {canWrite ? <button className={btn} onClick={() => setConfirm(true)}>Dispatch now</button> : null}
      </div>
      <Table head={["Reference", "Receiver", "Packets", "Status", "Trip", "Created"]}>
        {list.map((o) => (
          <tr key={o.id}>
            <td className={`${td} font-semibold`}>{o.reference_no ?? "—"}</td><td className={td}>{recMap.get(o.receiver_id) ?? "—"}</td>
            <td className={td}>{o.packet_count ?? 1}</td><td className={td}><Pill tone="info">{o.status}</Pill></td>
            <td className={td}>{o.batch_id ? <span className="font-mono text-[11px]">#{String(o.batch_id).slice(0, 8)}</span> : "—"}</td>
            <td className={td}>{new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
          </tr>
        ))}
      </Table>
      {list.length === 0 ? <p className="text-[13px] text-muted-foreground">No orders.</p> : null}
      {confirm ? (
        <ReasonDialog title="Dispatch now" confirmLabel="Dispatch" onClose={() => setConfirm(false)}
          body={<p className="text-[13px] text-muted-foreground">Groups {pending} pending order{pending === 1 ? "" : "s"} of {biz.business_name} into trips right away.</p>}
          onConfirm={async (reason) => { await dispatch({ data: { merchant_id: biz.merchant_id, reason } }); toast.success("Dispatch started"); onChanged(); }} />
      ) : null}
    </div>
  );
}

function TripsTab({ rows, canWriteOrders }: { rows: Array<Record<string, any>>; canWriteOrders: boolean }) {
  const qc = useQueryClient();
  const fetchOrders = useServerFn(listCourierOrders);
  const [order, setOrder] = useState<CourierOrderRow | null>(null);
  const tone = (s: string) => (s === "dispatched" ? "ok" : s === "failed" ? "warn" : s === "awaiting_balance" ? "warn" : "info") as "ok" | "warn" | "info";
  const openOrder = async (id: string) => {
    try { const r = await fetchOrders({ data: { orderId: id } }); if (r[0]) setOrder(r[0]); else toast.error("Courier order not found"); } catch (e) { err(e); }
  };
  return (
    <div className="space-y-3">
      <Table head={["Trip", "Status", "Drops", "Distance", "Fare", "Courier order", "Created"]}>
        {rows.map((b) => (
          <tr key={b.id}>
            <td className={`${td} font-mono text-[11px]`}>#{String(b.id).slice(0, 8)}</td>
            <td className={td}><Pill tone={tone(b.status)}>{String(b.status).replace(/_/g, " ")}</Pill>{b.fail_reason ? <p className="text-[11px] text-muted-foreground">{b.fail_reason}</p> : null}</td>
            <td className={td}>{b.drops_count ?? "—"}</td><td className={td}>{b.distance_km != null ? `${b.distance_km} km` : "—"}</td>
            <td className={td}>{inr(b.total_amount)}</td>
            <td className={td}>{b.courier_order_id ? <button className={btnGhost} onClick={() => openOrder(b.courier_order_id)}>Open order</button> : "—"}</td>
            <td className={td}>{new Date(b.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">No trips yet.</p> : null}
      {order ? <OrderDetail order={order} canWrite={canWriteOrders} onClose={() => setOrder(null)} onChanged={() => { setOrder(null); qc.invalidateQueries({ queryKey: ["bulk"] }); qc.invalidateQueries({ queryKey: ["courier", "orders"] }); }} /> : null}
    </div>
  );
}

function WalletTab({ biz, canWrite, ledger, topups, onChanged }: { biz: BusinessRow; canWrite: boolean; ledger: Array<Record<string, any>>; topups: Array<Record<string, any>>; onChanged: () => void }) {
  const adjust = useServerFn(businessWalletAdjust);
  const [form, setForm] = useState<{ type: "credit" | "debit"; amount: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-border p-4">
        <div>
          <p className="text-[12px] text-muted-foreground">Delivery wallet balance</p>
          <p className={`text-[22px] font-bold ${lowBal(biz) ? "text-destructive" : "text-foreground"}`}>{inr(biz.wallet_balance)}</p>
          {lowBal(biz) ? <p className="flex items-center gap-1 text-[12px] text-destructive"><AlertTriangle size={12} />Below low-balance limit ({inr(biz.low_balance_threshold)})</p> : null}
        </div>
        {canWrite ? <button className={btn} onClick={() => setForm({ type: "credit", amount: 0 })}>Add credit / Debit</button> : null}
      </div>
      <h4 className="text-[13px] font-bold">Ledger</h4>
      <Table head={["When", "Type", "Amount", "Reason"]}>
        {ledger.map((l) => <tr key={l.id}><td className={td}>{new Date(l.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td className={td}><Pill tone={l.type === "credit" ? "ok" : "warn"}>{l.type}</Pill></td><td className={`${td} font-semibold`}>{l.type === "credit" ? "+" : "−"}{inr(l.amount)}</td><td className={td}>{l.reason}</td></tr>)}
      </Table>
      {ledger.length === 0 ? <p className="text-[13px] text-muted-foreground">No ledger entries.</p> : null}
      <h4 className="text-[13px] font-bold">Top-ups</h4>
      <Table head={["When", "Amount", "Status", "Payment", "By"]}>
        {topups.map((t) => <tr key={t.id}><td className={td}>{new Date(t.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td className={td}>{inr(t.amount)}</td><td className={td}><Pill tone={t.status === "paid" ? "ok" : "off"}>{t.status}</Pill></td><td className={`${td} font-mono text-[11px]`}>{t.razorpay_payment_id ?? "—"}</td><td className={td}>{t.created_by_label ?? "—"}</td></tr>)}
      </Table>
      {topups.length === 0 ? <p className="text-[13px] text-muted-foreground">No top-ups.</p> : null}
      {form && !confirm ? (
        <Modal title="Adjust delivery wallet" onClose={() => setForm(null)}>
          <div className="space-y-3">
            <Tabs value={form.type} onChange={(t) => setForm({ ...form, type: t })} items={[{ key: "credit", label: "Add credit" }, { key: "debit", label: "Debit" }] as const} />
            <Field label="Amount ₹"><input type="number" min={0} className={inputCls} value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></Field>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={() => setForm(null)}>Cancel</button>
              <button className={btn} disabled={!(form.amount > 0)} onClick={() => setConfirm(true)}>Continue</button>
            </div>
          </div>
        </Modal>
      ) : null}
      {form && confirm ? (
        <ReasonDialog title={`Confirm ${form.type}`} confirmLabel={`Confirm ${form.type} ${inr(form.amount)}`} onClose={() => { setConfirm(false); setForm(null); }}
          body={<p className="text-[13px] text-foreground">{form.type === "credit" ? "Add" : "Debit"} <b>{inr(form.amount)}</b> {form.type === "credit" ? "to" : "from"} {biz.business_name}'s delivery wallet?</p>}
          onConfirm={async (reason) => { await adjust({ data: { merchant_id: biz.merchant_id, type: form.type, amount: form.amount, reason } }); toast.success("Wallet updated"); onChanged(); }} />
      ) : null}
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

type BTab = "pricing" | "dispatch" | "businesses";

export function BulkCourierPage({ canWriteOrders }: { canWriteOrders: boolean }) {
  const fetchAccess = useServerFn(getBulkAccess);
  const { data: access } = useQuery({ queryKey: ["bulk", "access"], queryFn: () => fetchAccess(), retry: false });
  const [tab, setTab] = useState<BTab>("pricing");
  const canWrite = !!access?.canWrite;
  const canOperate = !!access?.canOperate;
  return (
    <div className="space-y-4">
      {access && !canWrite ? (
        <div className="rounded-[12px] border border-border bg-muted px-4 py-2 text-[12px] text-muted-foreground">
          Read-only — only a super admin can change plans, modules, delivery status or wallet. You can still dispatch now and manage pickup points.
        </div>
      ) : null}
      <Tabs value={tab} onChange={setTab} items={[{ key: "pricing", label: "Pricing Plans" }, { key: "dispatch", label: "Dispatch Plans" }, { key: "businesses", label: "Businesses" }] as const} />
      {tab === "pricing" ? <PricingPlansTab canWrite={canWrite} /> : tab === "dispatch" ? <DispatchPlansTab canWrite={canWrite} /> : <BusinessesTab canWrite={canWrite} canOperate={canOperate} canWriteOrders={canWriteOrders} />}
    </div>
  );
}
