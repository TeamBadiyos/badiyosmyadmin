import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Plus, Check, Undo2, Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  listFeeTiers,
  upsertFeeTier,
  listBillableMerchants,
  setMerchantFeeTier,
  generateSubscriptionInvoices,
  listSubscriptionInvoices,
  markInvoicePaid,
  type FeeTier,
} from "@/lib/merchant-billing.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";
type Tab = "merchants" | "tiers" | "invoices";

const TABS: { key: Tab; label: string }[] = [
  { key: "merchants", label: "Merchant plans" },
  { key: "tiers", label: "Fee Tiers" },
  { key: "invoices", label: "Subscription Invoices" },
];

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const monthLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export function MerchantBillingPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const isSuper = role === "super_admin";
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("merchants");

  const fetchTiers = useServerFn(listFeeTiers);
  const fetchMerchants = useServerFn(listBillableMerchants);
  const fetchInvoices = useServerFn(listSubscriptionInvoices);
  const saveTier = useServerFn(upsertFeeTier);
  const assignTier = useServerFn(setMerchantFeeTier);
  const genInvoices = useServerFn(generateSubscriptionInvoices);
  const markPaid = useServerFn(markInvoicePaid);

  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const tiersQ = useQuery({ queryKey: ["billing", "tiers"], queryFn: () => fetchTiers({}) });
  const merchantsQ = useQuery({
    queryKey: ["billing", "merchants"],
    queryFn: () => fetchMerchants({}),
    enabled: tab === "merchants",
  });
  const invoicesQ = useQuery({
    queryKey: ["billing", "invoices", statusFilter, monthFilter],
    queryFn: () =>
      fetchInvoices({
        data: { status: statusFilter || null, month: monthFilter ? `${monthFilter}-01` : null },
      }),
    enabled: tab === "invoices",
  });

  const assignM = useMutation({
    mutationFn: (p: { merchantId: string; feeTierId: string | null }) => assignTier({ data: p }),
    onSuccess: () => {
      toast.success("Plan updated");
      qc.invalidateQueries({ queryKey: ["billing", "merchants"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const tierM = useMutation({
    mutationFn: (p: { id?: string; name?: string; monthlyFee?: number; isActive?: boolean }) =>
      saveTier({ data: p }),
    onSuccess: () => {
      toast.success("Fee tier saved");
      qc.invalidateQueries({ queryKey: ["billing", "tiers"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const genM = useMutation({
    mutationFn: () => genInvoices({}),
    onSuccess: (r) => {
      toast.success(
        r.created > 0
          ? `${r.created} invoice(s) created for ${monthLabel(r.billingMonth)}`
          : `No new invoices — ${monthLabel(r.billingMonth)} already generated`,
      );
      qc.invalidateQueries({ queryKey: ["billing", "invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Generation failed"),
  });

  const paidM = useMutation({
    mutationFn: (p: { invoiceId: string; paid: boolean }) => markPaid({ data: p }),
    onSuccess: () => {
      toast.success("Invoice updated");
      qc.invalidateQueries({ queryKey: ["billing", "invoices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const tiers = tiersQ.data ?? [];
  const activeTiers = tiers.filter((t) => t.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Assign subscription plans, manage fee tiers and run monthly merchant billing.
        </p>
        <div className="flex gap-2">
          {tab === "invoices" && canManage && (
            <button
              onClick={() => genM.mutate()}
              disabled={genM.isPending}
              className="h-10 px-4 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Receipt size={14} /> Generate this month
            </button>
          )}
          <button
            onClick={() => {
              tiersQ.refetch();
              merchantsQ.refetch();
              invoicesQ.refetch();
            }}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] font-semibold inline-flex items-center gap-2"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
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

      {tab === "merchants" && (
        <div className="bg-card border border-border rounded-[18px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_220px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span>Store / Owner</span>
            <span>Phone</span>
            <span>City</span>
            <span>Plan</span>
          </div>
          {merchantsQ.isLoading && (
            <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>
          )}
          {(merchantsQ.data ?? []).map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_220px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
            >
              <span className="truncate">
                <span className="font-semibold text-foreground">{m.storeName || "Unnamed store"}</span>
                <span className="text-muted-foreground"> · {m.ownerName || "—"}</span>
              </span>
              <span className="font-mono text-[13px] text-muted-foreground">{m.phone}</span>
              <span className="text-[13px] text-muted-foreground">{m.city || "—"}</span>
              <select
                disabled={!canManage || assignM.isPending}
                value={m.feeTierId ?? ""}
                onChange={(e) =>
                  assignM.mutate({ merchantId: m.id, feeTierId: e.target.value || null })
                }
                className="h-9 px-3 rounded-[10px] border border-border bg-background text-[13px] disabled:opacity-60"
              >
                <option value="">No plan</option>
                {activeTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {inr(t.monthlyFee)}/mo
                  </option>
                ))}
              </select>
            </div>
          ))}
          {!merchantsQ.isLoading && (merchantsQ.data ?? []).length === 0 && (
            <p className="text-[13px] text-muted-foreground py-10 text-center">
              No approved merchants yet.
            </p>
          )}
        </div>
      )}

      {tab === "tiers" && (
        <FeeTiersSection
          tiers={tiers}
          canEdit={isSuper}
          saving={tierM.isPending}
          onSave={(p) => tierM.mutate(p)}
        />
      )}

      {tab === "invoices" && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px]"
            />
            {monthFilter && (
              <button
                onClick={() => setMonthFilter("")}
                className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] font-semibold"
              >
                Clear month
              </button>
            )}
          </div>

          <div className="bg-card border border-border rounded-[18px] overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_120px_110px_130px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Merchant</span>
              <span>Tier</span>
              <span>Billing month</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {invoicesQ.isLoading && (
              <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>
            )}
            {(invoicesQ.data ?? []).map((i) => (
              <div
                key={i.id}
                className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_120px_110px_130px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
              >
                <span className="truncate font-semibold text-foreground">
                  {i.merchantName || "—"}
                </span>
                <span className="text-[13px] text-muted-foreground">{i.feeTierName || "—"}</span>
                <span className="text-[13px] text-muted-foreground">{monthLabel(i.billingMonth)}</span>
                <span className="font-semibold">{inr(i.amount)}</span>
                <span
                  className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full w-fit ${
                    i.status === "paid"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {i.status}
                </span>
                {canManage ? (
                  i.status === "paid" ? (
                    <button
                      disabled={paidM.isPending}
                      onClick={() => paidM.mutate({ invoiceId: i.id, paid: false })}
                      className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Undo2 size={14} /> Undo
                    </button>
                  ) : (
                    <button
                      disabled={paidM.isPending}
                      onClick={() => paidM.mutate({ invoiceId: i.id, paid: true })}
                      className="h-9 px-3 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Check size={14} /> Mark paid
                    </button>
                  )
                ) : (
                  <span className="text-[13px] text-muted-foreground">—</span>
                )}
              </div>
            ))}
            {!invoicesQ.isLoading && (invoicesQ.data ?? []).length === 0 && (
              <p className="text-[13px] text-muted-foreground py-10 text-center">No invoices.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeeTiersSection({
  tiers,
  canEdit,
  saving,
  onSave,
}: {
  tiers: FeeTier[];
  canEdit: boolean;
  saving: boolean;
  onSave: (p: { id?: string; name?: string; monthlyFee?: number; isActive?: boolean }) => void;
}) {
  const [name, setName] = useState("");
  const [fee, setFee] = useState("");

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="bg-card border border-border rounded-[18px] p-6 flex gap-3 flex-wrap items-end">
          <div className="space-y-1">
            <label className="text-[12px] font-semibold text-muted-foreground">Tier name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Premium"
              className="h-10 px-3 rounded-[12px] border border-border bg-background text-[14px] block"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] font-semibold text-muted-foreground">Monthly fee (₹)</label>
            <input
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
              placeholder="1499"
              className="h-10 px-3 rounded-[12px] border border-border bg-background text-[14px] block"
            />
          </div>
          <button
            disabled={saving || !name.trim() || !fee.trim()}
            onClick={() => {
              onSave({ name: name.trim(), monthlyFee: Number(fee), isActive: true });
              setName("");
              setFee("");
            }}
            className="h-10 px-4 rounded-[12px] bg-primary text-white text-[13px] font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={14} /> Add tier
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_160px_120px_200px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Name</span>
          <span>Monthly fee</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {tiers.map((t) => (
          <TierRow key={t.id} tier={t} canEdit={canEdit} saving={saving} onSave={onSave} />
        ))}
        {tiers.length === 0 && (
          <p className="text-[13px] text-muted-foreground py-10 text-center">No fee tiers yet.</p>
        )}
      </div>
    </div>
  );
}

function TierRow({
  tier,
  canEdit,
  saving,
  onSave,
}: {
  tier: FeeTier;
  canEdit: boolean;
  saving: boolean;
  onSave: (p: { id?: string; name?: string; monthlyFee?: number; isActive?: boolean }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tier.name);
  const [fee, setFee] = useState(String(tier.monthlyFee));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_160px_120px_200px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]">
      {editing ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 px-3 rounded-[10px] border border-border bg-background text-[14px]"
        />
      ) : (
        <span className="font-semibold text-foreground truncate">{tier.name}</span>
      )}
      {editing ? (
        <input
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          inputMode="decimal"
          className="h-9 px-3 rounded-[10px] border border-border bg-background text-[14px]"
        />
      ) : (
        <span>{inr(tier.monthlyFee)}</span>
      )}
      <span
        className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full w-fit ${
          tier.isActive ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
        }`}
      >
        {tier.isActive ? "active" : "inactive"}
      </span>
      <div className="flex gap-2">
        {canEdit ? (
          editing ? (
            <>
              <button
                disabled={saving}
                onClick={() => {
                  onSave({ id: tier.id, name: name.trim(), monthlyFee: Number(fee) });
                  setEditing(false);
                }}
                className="h-9 px-3 rounded-[12px] bg-primary text-white text-[13px] font-bold disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setName(tier.name);
                  setFee(String(tier.monthlyFee));
                }}
                className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-semibold"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-semibold"
              >
                Edit
              </button>
              <button
                disabled={saving}
                onClick={() => onSave({ id: tier.id, isActive: !tier.isActive })}
                className="h-9 px-3 rounded-[12px] border border-border text-[13px] font-semibold disabled:opacity-50"
              >
                {tier.isActive ? "Deactivate" : "Activate"}
              </button>
            </>
          )
        ) : (
          <span className="text-[13px] text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
