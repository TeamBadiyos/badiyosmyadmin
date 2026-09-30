import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Ban, FileText, RefreshCw, Pencil, Package, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";
import {
  listMerchants,
  decideMerchant,
  raiseMerchantQuery,
  setMerchantCommission,
  type MerchantStatus,
  type MerchantRow,
} from "@/lib/merchants.functions";
import { MerchantEditModal } from "@/components/merchant-edit-modal";
import { MerchantProductsModal } from "@/components/merchant-products-modal";

const QUERY_DOC_OPTIONS: { value: string; label: string }[] = [
  { value: "cancelled_cheque", label: "Bank cheque / passbook" },
  { value: "shop_license", label: "Shop licence" },
  { value: "pan", label: "PAN card" },
  { value: "aadhaar", label: "Aadhaar card" },
  { value: "gst_certificate", label: "GST certificate" },
  { value: "store_details", label: "Store details / address" },
];

const QUICK_REASONS = [
  "Bank document is blurred — account number and IFSC are not readable.",
  "Account holder name does not match the owner name.",
  "Shop licence photo is cut off or expired. Upload a clear, valid copy.",
  "Aadhaar / PAN card is not readable. Upload a clear photo of both sides.",
  "Wrong document uploaded. Please upload the correct one.",
];

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const STATUS_STYLES: Record<MerchantStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  suspended: "bg-red-50 text-red-700",
};

const TABS: { key: MerchantStatus | "" ; label: string }[] = [
  { key: "pending_review", label: "Pending review" },
  { key: "draft", label: "Draft / Incomplete" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "suspended", label: "Suspended" },
  { key: "", label: "All" },
];

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function MerchantApprovalsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MerchantStatus | "">("pending_review");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productsId, setProductsId] = useState<string | null>(null);
  const [commissionFor, setCommissionFor] = useState<MerchantRow | null>(null);
  const [rejectFor, setRejectFor] = useState<MerchantRow | null>(null);
  const [queryFor, setQueryFor] = useState<MerchantRow | null>(null);

  const fetchRows = useServerFn(listMerchants);
  const decide = useServerFn(decideMerchant);

  const { data: rows = [], isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["merchants", "list", tab],
    queryFn: () => fetchRows({ data: { status: tab || null } }),
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: (p: { merchantId: string; decision: "approved" | "rejected"; notes?: string }) =>
      decide({ data: p }),
    onSuccess: (_r, p) => {
      toast.success(`Merchant ${p.decision}`);
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });


  const isDraftTab = tab === "draft";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          {isDraftTab
            ? "Merchants stuck mid-onboarding — follow up manually so no lead is lost."
            : tab === "suspended"
              ? "Suspended stores — they can't take orders. Use Edit to review or set them live again."
              : "Review merchant applications, their GST details and uploaded documents."}
        </p>
        <button
          onClick={() => refetch()}
          className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-2"
        >
          <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key || "all"}
            onClick={() => setTab(t.key)}
            className={`h-9 px-4 rounded-full text-[13px] font-semibold border transition-colors ${
              tab === t.key
                ? "bg-primary text-white border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>}
      {isError && (
        <p className="text-[13px] text-destructive py-10 text-center">Failed to load merchants.</p>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-[13px] text-muted-foreground py-10 text-center">Nothing here.</p>
      )}

      {isDraftTab ? (
        <div className="bg-card border border-border rounded-[18px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_minmax(0,1fr)_190px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Store / Owner</span>
            <span>Phone</span>
            <span>Step</span>
            <span>Last updated</span>
            <span className="text-right">Actions</span>
          </div>
          {rows.map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_minmax(0,1fr)_190px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
            >
              <span className="truncate">
                <span className="font-semibold text-foreground">{m.storeName || "Unnamed store"}</span>
                <span className="text-muted-foreground"> · {m.ownerName || "—"}</span>
              </span>
              <span className="font-mono text-[13px] text-muted-foreground">{m.phone}</span>
              <span className="text-[13px] text-muted-foreground">Step {m.onboardingStep}</span>
              <span className="text-[13px] text-muted-foreground">{fmt(m.updatedAt)}</span>
              <span className="text-right flex justify-end gap-2">
                <button
                  onClick={() => setProductsId(m.id)}
                  className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1"
                >
                  <Package size={13} /> Items
                </button>
                {canManage && (
                  <button
                    onClick={() => setEditingId(m.id)}
                    className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-semibold inline-flex items-center gap-1"
                  >
                    <Pencil size={13} /> Edit
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          {rows.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-[18px] p-6 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-[16px] font-bold text-foreground truncate">
                      {m.storeName || "Unnamed store"}
                    </h3>
                    <span
                      className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${STATUS_STYLES[m.status]}`}
                    >
                      {m.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted-foreground mt-1">
                    {m.ownerName || "—"} · <span className="font-mono">{m.phone}</span> · applied{" "}
                    {fmt(m.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setProductsId(m.id)}
                    className="h-9 px-3 rounded-[12px] border border-border font-bold text-[13px] inline-flex items-center gap-1"
                  >
                    <Package size={14} /> Items
                  </button>
                  {canManage && (
                    <button
                      onClick={() => setEditingId(m.id)}
                      className="h-9 px-3 rounded-[12px] border border-border font-bold text-[13px] inline-flex items-center gap-1"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                  )}
                  {canManage && (m.status === "pending_review" || m.status === "draft") && (
                    <>
                      <button
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ merchantId: m.id, decision: "approved" })}
                        className="h-9 px-3 rounded-[12px] bg-primary text-white font-bold text-[13px] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button
                        disabled={mutation.isPending}
                        onClick={() => onReject(m)}
                        className="h-9 px-3 rounded-[12px] border border-border text-destructive font-bold text-[13px] inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <Ban size={14} /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[13px]">
                <Field label="GST">
                  {m.isGstRegistered
                    ? `Registered${m.gstin ? ` · ${m.gstin}` : ""}${m.gstStatus ? ` (${m.gstStatus})` : ""}`
                    : "Not registered"}
                </Field>
                <Field label="GST legal name">{m.gstLegalName || "—"}</Field>
                <Field label="Category">
                  {[m.segmentName, m.categoryName].filter(Boolean).join(" · ") || "—"}
                </Field>
                <Field label="Address">
                  {[m.address, m.city, m.pincode].filter(Boolean).join(", ") || "—"}
                </Field>
              </div>

              <div className="flex items-center gap-3 flex-wrap rounded-[12px] bg-muted/40 px-3 py-2">
                <span className="text-[13px] font-semibold text-foreground">
                  Commission: {m.commissionPct}%
                </span>
                {role === "super_admin" && (
                  <button
                    onClick={() => setCommissionFor(m)}
                    className="h-8 px-3 rounded-[10px] border border-border bg-card text-[12px] font-semibold inline-flex items-center gap-1"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                )}
                <span className="text-[12px] text-muted-foreground">Applies to new orders only</span>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  Documents ({m.docs.length})
                </p>
                {m.docs.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No documents uploaded.</p>
                ) : (
                  <div className="flex gap-3 flex-wrap">
                    {m.docs.map((d) => (
                      <a
                        key={d.id}
                        href={d.url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="w-[140px] rounded-[12px] border border-border overflow-hidden bg-muted/30 hover:border-primary transition-colors"
                      >
                        <div className="h-[90px] flex items-center justify-center bg-muted/50">
                          {d.url ? (
                            <img
                              src={d.url}
                              alt={d.docType}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <FileText size={20} className="text-muted-foreground" />
                          )}
                        </div>
                        <p className="px-2 py-1.5 text-[12px] font-semibold truncate">{d.docType}</p>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <MerchantEditModal merchantId={editingId} onClose={() => setEditingId(null)} />
      )}

      {productsId && (
        <MerchantProductsModal merchantId={productsId} onClose={() => setProductsId(null)} />
      )}

      {commissionFor && (
        <CommissionModal merchant={commissionFor} onClose={() => setCommissionFor(null)} />
      )}
    </div>
  );
}

function CommissionModal({ merchant, onClose }: { merchant: MerchantRow; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(setMerchantCommission);
  const [pct, setPct] = useState(String(merchant.commissionPct));

  const m = useMutation({
    mutationFn: () => save({ data: { merchantId: merchant.id, pct: Number(pct) } }),
    onSuccess: () => {
      toast.success("Commission updated");
      qc.invalidateQueries({ queryKey: ["merchants"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update"),
  });

  const value = Number(pct);
  const valid = Number.isFinite(value) && value >= 0 && value <= 50;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-[18px] bg-card border border-border p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-[16px] font-bold text-foreground">Commission</h3>
          <p className="text-[13px] text-muted-foreground">{merchant.storeName || "Unnamed store"}</p>
        </div>

        <div>
          <label className="text-[12px] font-semibold text-muted-foreground">Commission %</label>
          <input
            type="number"
            min={0}
            max={50}
            step="0.01"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="mt-1 w-full h-10 rounded-[12px] border border-border bg-background px-3 text-[14px]"
          />
          <p className="mt-1 text-[12px] text-muted-foreground">
            Between 0 and 50%. Applies to new orders only.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-[12px] border border-border text-[13px] font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={!valid || m.isPending}
            onClick={() => m.mutate()}
            className="flex-1 h-10 rounded-[12px] bg-primary text-white text-[13px] font-bold disabled:opacity-50"
          >
            {m.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-foreground mt-0.5 break-words">{children}</p>
    </div>
  );
}
