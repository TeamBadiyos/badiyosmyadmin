import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Package, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";

import {
  listMerchantProducts,
  setProductAdminHidden,
  setProductApproval,
} from "@/lib/merchants.functions";

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function MerchantProductsModal({
  merchantId,
  onClose,
}: {
  merchantId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fetchProducts = useServerFn(listMerchantProducts);
  const toggleFn = useServerFn(setProductAdminHidden);
  const approveFn = useServerFn(setProductApproval);
  const [q, setQ] = useState("");

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["merchant", "products", merchantId],
    queryFn: () => fetchProducts({ data: { merchantId } }),
    staleTime: 10_000,
  });

  const canManage = data?.role === "super_admin";
  const canApprove = data?.role === "super_admin" || data?.role === "ops_manager";
  const products = data?.products ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.categoryLabel ?? "").toLowerCase().includes(term),
    );
  }, [products, q]);

  const lowStock = products.filter(
    (p) => p.stockQuantity <= p.lowStockThreshold,
  ).length;
  const merchantHidden = products.filter((p) => !p.isActive).length;
  const adminHidden = products.filter((p) => p.adminHidden).length;
  const pendingIds = products.filter((p) => p.approvalStatus === "pending").map((p) => p.id);

  const approval = useMutation({
    mutationFn: (p: { productIds: string[]; decision: "approved" | "rejected"; reason?: string | null }) =>
      approveFn({ data: p }),
    onSuccess: (r, p) => {
      toast.success(`${r.count} item${r.count === 1 ? "" : "s"} ${p.decision}`);
      queryClient.invalidateQueries({ queryKey: ["merchant", "products", merchantId] });
      queryClient.invalidateQueries({ queryKey: ["merchants"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update item"),
  });
  const reject = (ids: string[]) => {
    const reason = window.prompt("Reason for rejecting (merchant will see this)");
    if (!reason || !reason.trim()) return;
    approval.mutate({ productIds: ids, decision: "rejected", reason });
  };

  const toggle = useMutation({
    mutationFn: (p: { productId: string; hidden: boolean; reason?: string | null }) =>
      toggleFn({ data: p }),
    onSuccess: (_r, p) => {
      toast.success(p.hidden ? "Hidden by admin" : "Admin hide removed");
      queryClient.invalidateQueries({
        queryKey: ["merchant", "products", merchantId],
      });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not update item"),
  });

  const onToggle = (productId: string, currentlyHidden: boolean) => {
    if (currentlyHidden) {
      toggle.mutate({ productId, hidden: false });
      return;
    }
    const reason = window.prompt("Reason for hiding this item (optional)");
    if (reason === null) return;
    toggle.mutate({ productId, hidden: true, reason });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-3 sm:p-6">
      <div className="w-full max-w-[880px] max-h-[90vh] rounded-[18px] bg-card border border-border flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-[16px] font-bold truncate">
              {data?.storeName ?? "Store items"}
            </p>
            <p className="text-[12px] text-muted-foreground truncate">
              {products.length} item{products.length === 1 ? "" : "s"}
              {lowStock > 0 ? ` · ${lowStock} low stock` : ""}
              {merchantHidden > 0 ? ` · ${merchantHidden} hidden by merchant` : ""}
              {adminHidden > 0 ? ` · ${adminHidden} hidden by admin` : ""}
              {pendingIds.length > 0 ? ` · ${pendingIds.length} pending approval` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="h-9 w-9 rounded-[12px] border border-border grid place-items-center"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-[12px] border border-border grid place-items-center"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {pendingIds.length > 0 && (
          <div className="px-5 py-3 border-b border-border bg-accent/40 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">
              {pendingIds.length} item{pendingIds.length === 1 ? "" : "s"} pending for approval
            </p>
            {canApprove && (
              <div className="flex gap-2">
                <button
                  disabled={approval.isPending}
                  onClick={() => approval.mutate({ productIds: pendingIds, decision: "approved" })}
                  className="h-8 px-3 rounded-[10px] bg-primary text-primary-foreground text-[12px] font-bold disabled:opacity-50"
                >
                  Approve all
                </button>
                <button
                  disabled={approval.isPending}
                  onClick={() => reject(pendingIds)}
                  className="h-8 px-3 rounded-[10px] border border-border text-[12px] font-bold disabled:opacity-50"
                >
                  Reject all
                </button>
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search item or category"
              className="w-full h-10 pl-9 pr-3 rounded-[12px] border border-border bg-background text-[13px]"
            />
          </div>
        </div>

        <div className="overflow-y-auto">
          {isLoading && (
            <p className="text-[13px] text-muted-foreground py-12 text-center">
              Loading…
            </p>
          )}
          {isError && (
            <p className="text-[13px] text-destructive py-12 text-center">
              Could not load items.
            </p>
          )}
          {!isLoading && !isError && filtered.length === 0 && (
            <p className="text-[13px] text-muted-foreground py-12 text-center">
              {products.length === 0
                ? "This store has not added any items yet."
                : "No items match your search."}
            </p>
          )}

          {filtered.map((p) => {
            const low = p.stockQuantity <= p.lowStockThreshold;
            return (
              <div
                key={p.id}
                className="grid grid-cols-[48px_1fr_auto] sm:grid-cols-[48px_1fr_110px_120px_70px] gap-3 px-5 py-3 border-b border-border last:border-0 items-center"
              >
                <div className="h-12 w-12 rounded-[14px] bg-muted overflow-hidden grid place-items-center text-muted-foreground">
                  {p.imageUrl && !brokenImages.has(p.id) ? (
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={() => setBrokenImages((s) => new Set(s).add(p.id))}
                    />
                  ) : (
                    <Package size={18} />
                  )}
                </div>

                <div className="min-w-0">
                  <p className="text-[14px] font-bold truncate">{p.name}</p>
                  <p className="text-[12px] text-muted-foreground truncate">
                    {p.categoryLabel ?? "Uncategorised"}
                    {p.unit ? ` · ${p.unit}` : ""}
                  </p>
                  {(!p.isActive || p.adminHidden || p.approvalStatus !== "approved") && (
                    <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                      {p.approvalStatus === "pending" && (
                        <span className="inline-flex h-6 px-2 items-center rounded-full bg-accent text-accent-foreground border border-border text-[11px] font-semibold">
                          Pending approval
                        </span>
                      )}
                      {p.approvalStatus === "rejected" && (
                        <span
                          title={p.approvalReason ?? undefined}
                          className="inline-flex h-6 px-2 items-center rounded-full bg-destructive/10 text-destructive text-[11px] font-semibold"
                        >
                          Rejected{p.approvalReason ? `: ${p.approvalReason}` : ""}
                        </span>
                      )}
                      {canApprove && p.approvalStatus !== "approved" && (
                        <button
                          disabled={approval.isPending}
                          onClick={() => approval.mutate({ productIds: [p.id], decision: "approved" })}
                          className="h-6 px-2 rounded-full bg-primary text-primary-foreground text-[11px] font-bold disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                      {canApprove && p.approvalStatus === "pending" && (
                        <button
                          disabled={approval.isPending}
                          onClick={() => reject([p.id])}
                          className="h-6 px-2 rounded-full border border-border text-[11px] font-bold disabled:opacity-50"
                        >
                          Reject
                        </button>
                      )}
                      {!p.isActive && (
                        <span className="inline-flex h-6 px-2 items-center rounded-full bg-muted text-muted-foreground text-[11px] font-semibold">
                          Hidden by merchant
                        </span>
                      )}
                      {p.adminHidden && (
                        <span
                          title={p.adminHiddenReason ?? undefined}
                          className="inline-flex h-6 px-2 items-center rounded-full bg-destructive/10 text-destructive text-[11px] font-semibold"
                        >
                          Hidden by admin
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="text-[14px] font-bold sm:text-left text-right">
                  {inr(p.price)}
                </div>

                <div className="hidden sm:block">
                  <span
                    className={`inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-semibold ${
                      low
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {p.stockQuantity} in stock
                  </span>
                </div>

                <div className="hidden sm:flex justify-end">
                  <button
                    disabled={!canManage || toggle.isPending}
                    onClick={() => onToggle(p.id, p.adminHidden)}
                    className={`h-7 w-12 rounded-full transition-colors relative disabled:opacity-50 ${
                      !p.adminHidden ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                    aria-label={p.adminHidden ? "Remove admin hide" : "Hide by admin"}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow transition-all ${
                        !p.adminHidden ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
