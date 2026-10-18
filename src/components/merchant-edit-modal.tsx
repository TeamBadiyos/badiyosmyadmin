import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { toast } from "sonner";

import {
  deleteMerchant,
  getMerchantDetail,
  listMerchantEditOptions,
  updateMerchantDetails,
  setMerchantCommissionMode,
  type MerchantStatus,
} from "@/lib/merchants.functions";
import { getMerchantModules, setBusinessModules } from "@/lib/bulk-courier.functions";


const STATUSES: { value: MerchantStatus; label: string }[] = [
  { value: "draft", label: "Draft / Incomplete" },
  { value: "pending_review", label: "Pending review" },
  { value: "approved", label: "Approved (live)" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
];

type FormState = {
  storeName: string;
  ownerName: string;
  phone: string;
  storeCategoryId: string;
  segmentId: string;
  zoneId: string;
  address: string;
  city: string;
  pincode: string;
  lat: string;
  lng: string;
  state: string;
  isAcceptingOrders: boolean;
  status: MerchantStatus;
  isGstRegistered: boolean;
  gstin: string;
  gstLegalName: string;
  bankHolder: string;
  bankAccount: string;
  bankIfsc: string;
  pan: string;
  serviceType: "store" | "food";
  email: string;
  upiId: string;
  fssaiNumber: string;
  fssaiExpiry: string;
  udyamNumber: string;
  shopPhotoUrl: string;
};

const EMPTY: FormState = {
  storeName: "",
  ownerName: "",
  phone: "",
  storeCategoryId: "",
  segmentId: "",
  zoneId: "",
  address: "",
  city: "",
  pincode: "",
  lat: "",
  lng: "",
  state: "",
  isAcceptingOrders: true,
  status: "pending_review",
  isGstRegistered: false,
  gstin: "",
  gstLegalName: "",
  bankHolder: "",
  bankAccount: "",
  bankIfsc: "",
  pan: "",
  serviceType: "store",
  email: "",
  upiId: "",
  fssaiNumber: "",
  fssaiExpiry: "",
  udyamNumber: "",
  shopPhotoUrl: "",
};

export function MerchantEditModal({
  merchantId,
  onClose,
}: {
  merchantId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchDetail = useServerFn(getMerchantDetail);
  const fetchOptions = useServerFn(listMerchantEditOptions);
  const save = useServerFn(updateMerchantDetails);

  const [form, setForm] = useState<FormState>(EMPTY);

  const { data: detail, isLoading } = useQuery({
    queryKey: ["merchant", "detail", merchantId],
    queryFn: () => fetchDetail({ data: { merchantId } }),
  });

  const { data: options } = useQuery({
    queryKey: ["merchant", "edit-options"],
    queryFn: () => fetchOptions(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!detail) return;
    setForm({
      storeName: detail.storeName ?? "",
      ownerName: detail.ownerName ?? "",
      phone: detail.phone ?? "",
      storeCategoryId: detail.storeCategoryId ?? "",
      segmentId: detail.segmentId ?? "",
      zoneId: detail.zoneId ?? "",
      address: detail.address ?? "",
      city: detail.city ?? "",
      pincode: detail.pincode ?? "",
      lat: detail.latitude != null ? String(detail.latitude) : "",
      lng: detail.longitude != null ? String(detail.longitude) : "",
      state: detail.state ?? "",
      isAcceptingOrders: detail.isAcceptingOrders,
      status: detail.status,
      isGstRegistered: !!detail.isGstRegistered,
      gstin: detail.gstin ?? "",
      gstLegalName: detail.gstLegalName ?? "",
      bankHolder: detail.bankHolder ?? "",
      bankAccount: detail.bankAccount ?? "",
      bankIfsc: detail.bankIfsc ?? "",
      pan: detail.pan ?? "",
      serviceType: detail.serviceType === "food" ? "food" : "store",
      email: detail.email ?? "",
      upiId: detail.upiId ?? "",
      fssaiNumber: detail.fssaiNumber ?? "",
      fssaiExpiry: detail.fssaiExpiry ? String(detail.fssaiExpiry).slice(0, 10) : "",
      udyamNumber: detail.udyamNumber ?? "",
      shopPhotoUrl: detail.shopPhotoUrl ?? "",
    });
  }, [detail]);

  const categories = useMemo(() => options?.categories ?? [], [options]);

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          merchantId,
          storeName: form.storeName,
          ownerName: form.ownerName || null,
          phone: form.phone,
          storeCategoryId: form.storeCategoryId || null,
          segmentId: form.segmentId || null,
          zoneId: form.zoneId || null,
          address: form.address || null,
          city: form.city || null,
          pincode: form.pincode || null,
          latitude: form.lat.trim() ? Number(form.lat) : null,
          longitude: form.lng.trim() ? Number(form.lng) : null,
          state: form.state || null,
          isAcceptingOrders: form.isAcceptingOrders,
          status: form.status,
          isGstRegistered: form.isGstRegistered,
          gstin: form.gstin || null,
          gstLegalName: form.gstLegalName || null,
          bankHolder: form.bankHolder || null,
          bankAccount: form.bankAccount || null,
          bankIfsc: form.bankIfsc || null,
          pan: form.pan || null,
          serviceType: form.serviceType,
          email: form.email || null,
          upiId: form.upiId || null,
          fssaiNumber: form.fssaiNumber || null,
          fssaiExpiry: form.fssaiExpiry || null,
          udyamNumber: form.udyamNumber || null,
          shopPhotoUrl: form.shopPhotoUrl || null,
        },
      }),
    onSuccess: () => {
      toast.success("Merchant updated");
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      queryClient.invalidateQueries({ queryKey: ["merchant", "detail", merchantId] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // When a category is picked, keep the segment aligned with it.
  function onCategory(id: string) {
    const cat = categories.find((c) => c.id === id);
    setForm((f) => ({
      ...f,
      storeCategoryId: id,
      segmentId: cat?.segment_id ?? f.segmentId,
    }));
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="bg-card border border-border rounded-[18px] w-full max-w-[720px] shadow-xl">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
          <h2 className="text-[16px] font-bold">Edit merchant</h2>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-[12px] border border-border inline-flex items-center justify-center"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <p className="text-[13px] text-muted-foreground py-14 text-center">Loading…</p>
        ) : detail?.deletedAt ? (
          <div className="p-6">
            <div className="rounded-[14px] border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-[14px] font-bold text-destructive">This store is deleted</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Deleted on {new Date(detail.deletedAt).toLocaleString("en-IN")}
                {detail.deleteReason ? ` · Reason: ${detail.deleteReason}` : ""}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                It is hidden from the app and Bulk Courier. Order history and reports are kept.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <ShopPhoto value={form.shopPhotoUrl} onChange={(v) => set("shopPhotoUrl", v)} />

            <Section title="Store & owner">
              <Text label="Store name" value={form.storeName} onChange={(v) => set("storeName", v)} />
              <Select
                label="Business type"
                value={form.serviceType}
                onChange={(v) => set("serviceType", v === "food" ? "food" : "store")}
                options={[
                  { value: "store", label: "Store (shop)" },
                  { value: "food", label: "Food (restaurant)" },
                ]}
              />
              <Text label="Owner name" value={form.ownerName} onChange={(v) => set("ownerName", v)} />
              <Text label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
              <Text label="Email" value={form.email} onChange={(v) => set("email", v)} />
              <Text label="UPI ID" value={form.upiId} onChange={(v) => set("upiId", v)} />
            </Section>

            <Section title="Licences">
              <Text label="FSSAI licence no." value={form.fssaiNumber} onChange={(v) => set("fssaiNumber", v.replace(/\D/g, "").slice(0, 14))} />
              <label className="block">
                <span className="block text-[12px] font-semibold text-muted-foreground mb-1.5">FSSAI expiry</span>
                <input type="date" value={form.fssaiExpiry} onChange={(e) => set("fssaiExpiry", e.target.value)}
                  className="w-full h-10 rounded-[12px] border border-border bg-background px-3 text-[14px]" />
              </label>
              <Text label="Udyam / Shop Act no." value={form.udyamNumber} onChange={(v) => set("udyamNumber", v.toUpperCase())} />
            </Section>

            <Section title="Category & placement">
              <Select
                label="Store category"
                value={form.storeCategoryId}
                onChange={onCategory}
                options={[
                  { value: "", label: "— none —" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Select
                label="Segment"
                value={form.segmentId}
                onChange={(v) => set("segmentId", v)}
                options={[
                  { value: "", label: "— none —" },
                  ...(options?.segments ?? []).map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
              <Select
                label="Zone"
                value={form.zoneId}
                onChange={(v) => set("zoneId", v)}
                options={[
                  { value: "", label: "— none —" },
                  ...(options?.zones ?? []).map((z) => ({
                    value: z.id,
                    label: `${z.name} · ${z.city}`,
                  })),
                ]}
              />
            </Section>

            <Section title="Address">
              <Text label="Address" value={form.address} onChange={(v) => set("address", v)} />
              <Text label="City" value={form.city} onChange={(v) => set("city", v)} />
              <Text label="Pincode" value={form.pincode} onChange={(v) => set("pincode", v)} />
              <LocationPin lat={form.lat} lng={form.lng} address={[form.address, form.city, form.pincode].filter(Boolean).join(", ")}
                onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />
              <Text label="State" value={form.state} onChange={(v) => set("state", v)} />
            </Section>

            <Section title="Status & orders">
              <Select
                label="Account status"
                value={form.status}
                onChange={(v) => set("status", v as MerchantStatus)}
                options={STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              />
              <Toggle
                label="Accepting orders"
                checked={form.isAcceptingOrders}
                onChange={(v) => set("isAcceptingOrders", v)}
              />
            </Section>

            <ModulesSection merchantId={merchantId} />


            <Section title="GST">
              <Toggle
                label="GST registered"
                checked={form.isGstRegistered}
                onChange={(v) => set("isGstRegistered", v)}
              />
              {form.isGstRegistered && (
                <>
                  <Text label="GSTIN" value={form.gstin} onChange={(v) => set("gstin", v)} />
                  <Text
                    label="GST legal name"
                    value={form.gstLegalName}
                    onChange={(v) => set("gstLegalName", v)}
                  />
                </>
              )}
            </Section>

            <Section title="Bank & payout details">
              <Text label="Account holder name" value={form.bankHolder} onChange={(v) => set("bankHolder", v)} />
              <Text label="Account number" value={form.bankAccount} onChange={(v) => set("bankAccount", v.replace(/\D/g, ""))} />
              <Text label="IFSC" value={form.bankIfsc} onChange={(v) => set("bankIfsc", v.toUpperCase())} />
              <Text label="PAN" value={form.pan} onChange={(v) => set("pan", v.toUpperCase())} />
            </Section>
            <p className="-mt-3 text-[12px] text-muted-foreground">
              Flat commission: <b>{detail?.commissionPct ?? 0}%</b> per order — change it from Merchant Commission & Billing.
            </p>
            {/* MRP/Other split commission hidden (unused); data kept. */}
            {false && detail && <CommissionModeBox merchantId={merchantId} detail={detail!} />}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border">
          <div>{!isLoading && !detail?.deletedAt && <DeleteStoreButton merchantId={merchantId} storeName={form.storeName} onClose={onClose} />}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-10 px-4 rounded-[12px] border border-border text-[13px] font-semibold"
            >
              Cancel
            </button>
            {!detail?.deletedAt && (
              <button
                disabled={mutation.isPending || isLoading}
                onClick={() => mutation.mutate()}
                className="h-10 px-5 rounded-[12px] bg-primary text-white text-[13px] font-bold disabled:opacity-50"
              >
                {mutation.isPending ? "Saving…" : "Save changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Store / Bulk Delivery modules for this merchant (super admin only, reason required). */
function ModulesSection({ merchantId }: { merchantId: string }) {
  const queryClient = useQueryClient();
  const fetchModules = useServerFn(getMerchantModules);
  const saveModules = useServerFn(setBusinessModules);
  const { data } = useQuery({
    queryKey: ["merchant", "modules", merchantId],
    queryFn: () => fetchModules({ data: { merchant_id: merchantId } }),
  });
  const [store, setStore] = useState<boolean | null>(null);
  const [delivery, setDelivery] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!data) return;
    setStore(data.store_enabled);
    setDelivery(data.delivery_enabled);
  }, [data]);

  const canWrite = !!data?.canWrite;
  const dirty = !!data && (store !== data.store_enabled || delivery !== data.delivery_enabled);
  const mutation = useMutation({
    mutationFn: () =>
      saveModules({
        data: { merchant_id: merchantId, store_enabled: !!store, delivery_enabled: !!delivery, reason: reason.trim() },
      }),
    onSuccess: () => {
      toast.success("Modules updated");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["merchant", "modules", merchantId] });
      queryClient.invalidateQueries({ queryKey: ["bulk"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (!data) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">Modules</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Toggle label="Show in customer app (Store)" checked={!!store} onChange={(v) => canWrite && setStore(v)} />
        <Toggle label="Bulk Delivery" checked={!!delivery} onChange={(v) => canWrite && setDelivery(v)} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Turn Store off to keep the store approved but hidden from the customer app until it should go live. Bulk Delivery gives them parcel trips and a delivery wallet.
        {data.delivery_status ? ` Delivery status: ${data.delivery_status}.` : ""}
      </p>
      {!canWrite ? (
        <p className="mt-2 text-[12px] text-muted-foreground">Only a super admin can change these.</p>
      ) : dirty ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="h-10 flex-1 rounded-[12px] border border-border bg-background px-3 text-[14px]"
          />
          <button
            disabled={!reason.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="h-10 rounded-[12px] bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : "Save modules"}
          </button>
        </div>
      ) : null}
    </div>
  );
}



/** Super-admin-only store delete with confirm + required reason. */
function DeleteStoreButton({
  merchantId,
  storeName,
  onClose,
}: {
  merchantId: string;
  storeName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchModules = useServerFn(getMerchantModules);
  const del = useServerFn(deleteMerchant);
  const { data: modules } = useQuery({
    queryKey: ["merchant", "modules", merchantId],
    queryFn: () => fetchModules({ data: { merchant_id: merchantId } }),
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () => del({ data: { merchantId, reason: reason.trim() } }),
    onSuccess: () => {
      toast.success("Store deleted");
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
      queryClient.invalidateQueries({ queryKey: ["merchant"] });
      queryClient.invalidateQueries({ queryKey: ["bulk"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  if (!modules?.canWrite) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="h-10 px-4 rounded-[12px] border border-destructive/50 text-destructive text-[13px] font-bold"
      >
        Delete store
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="h-10 w-full sm:w-56 rounded-[12px] border border-border bg-background px-3 text-[14px]"
      />
      <button
        disabled={!reason.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="h-10 px-4 rounded-[12px] bg-destructive text-destructive-foreground text-[13px] font-bold disabled:opacity-50"
      >
        {mutation.isPending ? "Deleting…" : `Delete "${storeName || "store"}"`}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="h-10 px-3 rounded-[12px] border border-border text-[13px] font-semibold"
      >
        Keep
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </p>
      <div className="grid sm:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-[12px] border border-border bg-background px-3 text-[14px]"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-[12px] border border-border bg-background px-3 text-[14px]"
      >
        {options.map((o) => (
          <option key={o.value || "none"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between h-10 rounded-[12px] border border-border px-3 text-[13px] font-semibold"
    >
      <span>{label}</span>
      <span
        className={`h-5 w-9 rounded-full transition-colors relative ${checked ? "bg-primary" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

function CommissionModeBox({ merchantId, detail }: { merchantId: string; detail: { commissionMode: "flat" | "split"; mrpCommissionPct: number; otherCommissionPct: number } }) {
  const qc = useQueryClient();
  const save = useServerFn(setMerchantCommissionMode);
  const [mode, setMode] = useState(detail.commissionMode);
  const [mrp, setMrp] = useState(String(detail.mrpCommissionPct));
  const [other, setOther] = useState(String(detail.otherCommissionPct));
  const m = useMutation({
    mutationFn: () => save({ data: { merchantId, mode, mrpPct: Number(mrp), otherPct: Number(other) } }),
    onSuccess: () => { toast.success("Commission mode saved (applies to new orders)"); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });
  const inp = "mt-1 w-full h-9 rounded-[10px] border border-border bg-background px-3 text-[13px]";
  return (
    <div className="rounded-[14px] border border-border p-4 space-y-3">
      <div className="text-[14px] font-bold text-foreground">Commission mode</div>
      <div className="flex gap-4 text-[13px]">
        <label className="flex items-center gap-2"><input type="radio" checked={mode === "flat"} onChange={() => setMode("flat")} /> Flat (one % for all items)</label>
        <label className="flex items-center gap-2"><input type="radio" checked={mode === "split"} onChange={() => setMode("split")} /> Split: MRP vs other items</label>
      </div>
      {mode === "split" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[12px] font-semibold text-muted-foreground">MRP items %<input type="number" min={0} max={50} step="0.01" className={inp} value={mrp} onChange={(e) => setMrp(e.target.value)} /></label>
          <label className="text-[12px] font-semibold text-muted-foreground">Other items %<input type="number" min={0} max={50} step="0.01" className={inp} value={other} onChange={(e) => setOther(e.target.value)} /></label>
          <p className="col-span-2 text-[12px] text-muted-foreground">Mark items as "MRP item" in the store's products. Super Admin only.</p>
        </div>
      )}
      <button type="button" disabled={m.isPending} onClick={() => m.mutate()} className="h-9 px-4 rounded-[10px] bg-primary text-primary-foreground text-[13px] font-bold disabled:opacity-50">
        {m.isPending ? "Saving…" : "Save commission mode"}
      </button>
    </div>
  );
}

function parseMapsLink(t: string): [string, string] | null {
  const m = t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  return m ? [m[1], m[2]] : null;
}

function LocationPin({ lat, lng, address, onChange }: { lat: string; lng: string; address: string; onChange: (lat: string, lng: string) => void }) {
  const [paste, setPaste] = useState("");
  const has = lat.trim() !== "" && lng.trim() !== "";
  const mapUrl = has ? `https://www.google.com/maps?q=${lat},${lng}` : `https://www.google.com/maps/search/${encodeURIComponent(address)}`;
  return (
    <div className="sm:col-span-2 rounded-[14px] border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-bold">Store location (GPS pin)</p>
        {has ? <span className="text-[12px] text-primary font-semibold">Pin set</span>
          : <span className="text-[12px] text-destructive font-semibold">No pin — customers can't get delivery</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="h-9 rounded-[10px] border border-border bg-background px-3 text-[13px]" placeholder="Latitude e.g. 18.4048" value={lat} onChange={(e) => onChange(e.target.value, lng)} />
        <input className="h-9 rounded-[10px] border border-border bg-background px-3 text-[13px]" placeholder="Longitude e.g. 76.5834" value={lng} onChange={(e) => onChange(lat, e.target.value)} />
      </div>
      <div className="flex gap-2">
        <input className="flex-1 h-9 rounded-[10px] border border-border bg-background px-3 text-[13px]" placeholder="Or paste a Google Maps link / “lat, lng”" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button type="button" className="h-9 px-3 rounded-[10px] border border-border text-[13px] font-semibold"
          onClick={() => { const r = parseMapsLink(paste); if (!r) { toast.error("Couldn't read a location from that link. Open the pin in Google Maps and copy the full link."); return; } onChange(r[0], r[1]); setPaste(""); }}>Use</button>
        <button type="button" className="h-9 px-3 rounded-[10px] border border-border text-[13px] font-semibold"
          onClick={() => navigator.geolocation?.getCurrentPosition((p) => onChange(p.coords.latitude.toFixed(6), p.coords.longitude.toFixed(6)), () => toast.error("Couldn't get your location"))}>My location</button>
      </div>
      <a href={mapUrl} target="_blank" rel="noreferrer" className="text-[12px] text-primary underline">{has ? "Check pin on Google Maps" : "Find address on Google Maps"}</a>
    </div>
  );
}
