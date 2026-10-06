import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Download, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  listMerchantCommissionBilling,
  type CommissionMerchant,
  type CommissionDeduction,
} from "@/lib/merchant-billing.functions";
import { setMerchantCommission } from "@/lib/merchants.functions";
import { useSortFilter, SortFilterHeader, SortFilterReset } from "@/components/table-sort-filter";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";
type Tab = "merchants" | "deductions";

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function MerchantBillingPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("merchants");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const fetchBilling = useServerFn(listMerchantCommissionBilling);
  const saveCommission = useServerFn(setMerchantCommission);

  const q = useQuery({
    queryKey: ["billing", "commission", month],
    queryFn: () => fetchBilling({ data: { month: month || null } }),
  });

  const merchantSf = useSortFilter(q.data?.merchants ?? [], [
    { key: "store", label: "Store", value: (m: CommissionMerchant) => m.storeName || "Unnamed store" },
    { key: "city", label: "City", value: (m: CommissionMerchant) => m.city || "—" },
    { key: "pct", label: "Commission %", type: "number", value: (m: CommissionMerchant) => m.commissionPct },
    { key: "orders", label: "Orders", type: "number", value: (m: CommissionMerchant) => m.orders, filterable: false },
    { key: "gross", label: "Gross sales", type: "number", value: (m: CommissionMerchant) => m.gross, filterable: false },
    { key: "comm", label: "Commission + GST", type: "number", value: (m: CommissionMerchant) => m.commission + m.commissionGst, filterable: false },
    { key: "net", label: "Merchant payout", type: "number", value: (m: CommissionMerchant) => m.merchantNet, filterable: false },
  ]);
  const dedSf = useSortFilter(q.data?.deductions ?? [], [
    { key: "date", label: "Date", value: (d: CommissionDeduction) => d.createdAt, display: (d: CommissionDeduction) => new Date(d.createdAt).toLocaleDateString("en-IN"), filterable: false },
    { key: "order", label: "Order", value: (d: CommissionDeduction) => d.orderNumber, filterable: false },
    { key: "merchant", label: "Merchant", value: (d: CommissionDeduction) => d.merchantName || "—" },
    { key: "items", label: "Items total", type: "number", value: (d: CommissionDeduction) => d.itemsTotal, filterable: false },
    { key: "pct", label: "%", type: "number", value: (d: CommissionDeduction) => d.commissionPct },
    { key: "comm", label: "Commission", type: "number", value: (d: CommissionDeduction) => d.commission, filterable: false },
    { key: "gst", label: "GST", type: "number", value: (d: CommissionDeduction) => d.commissionGst, filterable: false },
    { key: "net", label: "Merchant net", type: "number", value: (d: CommissionDeduction) => d.merchantNet, filterable: false },
  ]);

  const commM = useMutation({
    mutationFn: (p: { merchantId: string; pct: number }) => saveCommission({ data: p }),
    onSuccess: () => {
      toast.success("Commission updated");
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["merchants"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const ms = q.data?.merchants ?? [];
  const totals = ms.reduce(
    (t, m) => ({
      gross: t.gross + m.gross,
      comm: t.comm + m.commission,
      gst: t.gst + m.commissionGst,
      net: t.net + m.merchantNet,
    }),
    { gross: 0, comm: 0, gst: 0, net: 0 },
  );

  function exportCsv() {
    if (tab === "merchants") {
      downloadCsv(`merchant-commission-${month || "all"}.csv`, [
        ["Store", "Owner", "Phone", "City", "Commission %", "Orders", "Gross sales", "Commission", "Commission GST", "Merchant payout", "Bank details"],
        ...ms.map((m) => [m.storeName ?? "", m.ownerName ?? "", m.phone, m.city ?? "", m.commissionPct, m.orders, m.gross, m.commission, m.commissionGst, m.merchantNet, m.bankReady ? "Added" : "Pending"]),
      ]);
    } else {
      downloadCsv(`commission-deductions-${month || "all"}.csv`, [
        ["Date", "Order", "Merchant", "Items total", "Commission %", "Commission", "GST", "Merchant net"],
        ...(q.data?.deductions ?? []).map((d) => [new Date(d.createdAt).toLocaleString("en-IN"), d.orderNumber, d.merchantName ?? "", d.itemsTotal, d.commissionPct, d.commission, d.commissionGst, d.merchantNet]),
      ]);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold">Merchant Commission & Billing</h1>
          <p className="text-[13px] text-muted-foreground">
            Har completed store order se merchant ka Commission % kata jata hai. Yahi % yahan se edit karo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-[12px] border border-border bg-background px-3 text-[13px]"
          />
          <button onClick={() => setMonth("")} className="h-10 px-3 rounded-[12px] border border-border text-[13px] font-semibold">
            All time
          </button>
          <button onClick={() => q.refetch()} className="h-10 w-10 rounded-[12px] border border-border inline-flex items-center justify-center" aria-label="Refresh">
            <RefreshCw size={15} />
          </button>
          <button onClick={exportCsv} className="h-10 px-4 rounded-[12px] bg-primary text-primary-foreground text-[13px] font-bold inline-flex items-center gap-2">
            <Download size={14} /> Download CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Gross sales" value={inr(totals.gross)} />
        <Stat label="Commission earned" value={inr(totals.comm)} />
        <Stat label="GST on commission" value={inr(totals.gst)} />
        <Stat label="Merchant payout" value={inr(totals.net)} />
      </div>

      <div className="flex gap-2">
        {(["merchants", "deductions"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`h-9 px-4 rounded-full text-[13px] font-semibold border ${tab === t ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}
          >
            {t === "merchants" ? "Merchant commission" : "Commission deductions"}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>
      ) : q.error ? (
        <p className="text-[13px] text-destructive py-10 text-center">{(q.error as Error).message}</p>
      ) : tab === "merchants" ? (
        <div className="rounded-[16px] border border-border bg-card overflow-x-auto">
          <div className="px-4 pt-3"><SortFilterReset sf={merchantSf} /></div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                {["store", "city", "pct", "orders", "gross", "comm", "net"].map((k) => (
                  <th key={k} className="px-4 py-2"><SortFilterHeader sf={merchantSf} colKey={k} /></th>
                ))}
                <th className="px-4 py-2">Bank</th>
              </tr>
            </thead>
            <tbody>
              {merchantSf.rows.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold">{m.storeName || "Unnamed store"}</p>
                    <p className="text-[11px] text-muted-foreground">{m.ownerName || "—"} · {m.phone}</p>
                  </td>
                  <td className="px-4 py-2.5">{m.city || "—"}</td>
                  <td className="px-4 py-2.5">
                    <PctCell m={m} canEdit={canManage} saving={commM.isPending} onSave={(pct) => commM.mutate({ merchantId: m.id, pct })} />
                  </td>
                  <td className="px-4 py-2.5">{m.orders}</td>
                  <td className="px-4 py-2.5">{inr(m.gross)}</td>
                  <td className="px-4 py-2.5">{inr(m.commission)}{m.commissionGst ? <span className="text-muted-foreground"> + {inr(m.commissionGst)} GST</span> : null}</td>
                  <td className="px-4 py-2.5 font-semibold">{inr(m.merchantNet)}</td>
                  <td className="px-4 py-2.5">
                    {m.bankReady ? (
                      <span className="text-[11px] font-semibold text-primary">Added</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-destructive">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
              {!merchantSf.rows.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No approved merchants.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-[16px] border border-border bg-card overflow-x-auto">
          <div className="px-4 pt-3"><SortFilterReset sf={dedSf} /></div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                {["date", "order", "merchant", "items", "pct", "comm", "gst", "net"].map((k) => (
                  <th key={k} className="px-4 py-2"><SortFilterHeader sf={dedSf} colKey={k} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dedSf.rows.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{new Date(d.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px]">{d.orderNumber || d.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5">{d.merchantName || "—"}</td>
                  <td className="px-4 py-2.5">{inr(d.itemsTotal)}</td>
                  <td className="px-4 py-2.5">{d.commissionPct}%</td>
                  <td className="px-4 py-2.5">{inr(d.commission)}</td>
                  <td className="px-4 py-2.5">{inr(d.commissionGst)}</td>
                  <td className="px-4 py-2.5 font-semibold">{inr(d.merchantNet)}</td>
                </tr>
              ))}
              {!dedSf.rows.length && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No completed store orders in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[20px] font-bold">{value}</p>
    </div>
  );
}

function PctCell({ m, canEdit, saving, onSave }: { m: CommissionMerchant; canEdit: boolean; saving: boolean; onSave: (pct: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(String(m.commissionPct));
  if (!edit) {
    return (
      <span className="inline-flex items-center gap-2 font-semibold">
        {m.commissionPct}%
        {canEdit && (
          <button onClick={() => { setVal(String(m.commissionPct)); setEdit(true); }} className="text-muted-foreground" aria-label="Edit commission">
            <Pencil size={12} />
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input type="number" min={0} max={50} step={0.5} value={val} onChange={(e) => setVal(e.target.value)} className="h-8 w-16 rounded-[8px] border border-border bg-background px-2 text-[13px]" />
      <button disabled={saving} onClick={() => { onSave(Number(val)); setEdit(false); }} className="h-8 w-8 inline-flex items-center justify-center rounded-[8px] bg-primary text-primary-foreground" aria-label="Save"><Check size={13} /></button>
      <button onClick={() => setEdit(false)} className="h-8 w-8 inline-flex items-center justify-center rounded-[8px] border border-border" aria-label="Cancel"><X size={13} /></button>
    </span>
  );
}
