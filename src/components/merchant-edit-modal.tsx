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
  state: string;
  isAcceptingOrders: boolean;
  status: MerchantStatus;
  isGstRegistered: boolean;
  gstin: string;
  gstLegalName: string;
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
  state: "",
  isAcceptingOrders: true,
  status: "pending_review",
  isGstRegistered: false,
  gstin: "",
  gstLegalName: "",
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
      state: detail.state ?? "",
      isAcceptingOrders: detail.isAcceptingOrders,
      status: detail.status,
      isGstRegistered: !!detail.isGstRegistered,
      gstin: detail.gstin ?? "",
      gstLegalName: detail.gstLegalName ?? "",
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
          state: form.state || null,
          isAcceptingOrders: form.isAcceptingOrders,
          status: form.status,
          isGstRegistered: form.isGstRegistered,
          gstin: form.gstin || null,
          gstLegalName: form.gstLegalName || null,
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
            <Section title="Store & owner">
              <Text label="Store name" value={form.storeName} onChange={(v) => set("storeName", v)} />
              <Text label="Owner name" value={form.ownerName} onChange={(v) => set("ownerName", v)} />
              <Text label="Phone" value={form.phone} onChange={(v) => set("phone", v)} />
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
        <Toggle label="badiyos Store" checked={!!store} onChange={(v) => canWrite && setStore(v)} />
        <Toggle label="Bulk Delivery" checked={!!delivery} onChange={(v) => canWrite && setDelivery(v)} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Store lets them list products and take online orders. Bulk Delivery gives them parcel trips and a delivery wallet.
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
