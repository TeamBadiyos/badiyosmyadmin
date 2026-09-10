import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, UserMinus } from "lucide-react";
import {
  listDeletionRequests,
  updateDeletionRequest,
  type DeletionRequest,
  type DeletionRequestStatus,
  type DeletionAccountType,
} from "@/lib/account-deletion.functions";

const TYPE_LABELS: Record<DeletionAccountType, string> = {
  customer: "Customer",
  expert: "Expert",
  merchant: "Merchant",
};

const TYPE_STYLES: Record<DeletionAccountType, string> = {
  customer: "bg-sky-50 text-sky-700",
  expert: "bg-violet-50 text-violet-700",
  merchant: "bg-teal-50 text-teal-700",
};

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const STATUS_STYLES: Record<DeletionRequestStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  in_progress: "bg-indigo-50 text-indigo-700",
  completed: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
};

function fmt(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DeletionRequestsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const fetchRequests = useServerFn(listDeletionRequests);
  const [status, setStatus] = useState("");
  const [accountType, setAccountType] = useState("");

  const { data: requests = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["deletion-requests", status, accountType],
    queryFn: () =>
      fetchRequests({ data: { status: status || null, accountType: accountType || null } }),
    staleTime: 10_000,
    enabled: canManage,
  });

  if (!canManage) {
    return (
      <p className="text-[14px] text-muted-foreground">
        You do not have access to account deletion requests.
      </p>
    );
  }

  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Deletion requests submitted from badiyos.com/delete-account. {pending} pending.
        </p>
        <button
          onClick={() => refetch()}
          className="h-[44px] px-4 rounded-[14px] border border-border text-[13px] font-bold inline-flex items-center gap-2 hover:bg-muted/40"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="bg-card border border-border rounded-[18px] p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Account type
          </label>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]"
          >
            <option value="">All types</option>
            <option value="customer">Customer</option>
            <option value="expert">Expert</option>
            <option value="merchant">Merchant</option>
          </select>
        </div>
      </div>

      {isLoading && <p className="text-[13px] text-muted-foreground py-10 text-center">Loading…</p>}
      {isError && (
        <p className="text-[13px] text-destructive py-10 text-center">Failed to load requests.</p>
      )}
      {!isLoading && !isError && requests.length === 0 && (
        <div className="bg-card border border-border rounded-[18px] py-16 text-center">
          <UserMinus size={28} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-[14px] text-muted-foreground">No deletion requests yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {requests.map((r) => (
          <RequestCard key={r.id} request={r} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ request }: { request: DeletionRequest }) {
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateDeletionRequest);
  const [note, setNote] = useState(request.staffNote ?? "");

  const mut = useMutation({
    mutationFn: (status: DeletionRequestStatus) =>
      updateFn({ data: { requestId: request.id, status, note } }),
    onSuccess: () => {
      toast.success("Request updated");
      queryClient.invalidateQueries({ queryKey: ["deletion-requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="bg-card border border-border rounded-[18px] p-5 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-foreground font-mono">{request.phone}</p>
          {request.email && (
            <p className="text-[13px] text-muted-foreground">{request.email}</p>
          )}
          <p className="text-[12px] text-muted-foreground">{fmt(request.createdAt)}</p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLES[request.status]}`}
        >
          {request.status.replace(/_/g, " ")}
        </span>
      </div>

      {request.reason && (
        <p className="text-[14px] text-foreground whitespace-pre-wrap">{request.reason}</p>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note (staff only)…"
        rows={2}
        className="w-full px-3 py-2 rounded-[12px] border border-border bg-card text-[13px]"
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(["in_progress", "completed", "rejected", "pending"] as DeletionRequestStatus[]).map((s) => (
          <button
            key={s}
            disabled={mut.isPending || request.status === s}
            onClick={() => mut.mutate(s)}
            className="h-9 px-4 rounded-[12px] border border-border text-[12px] font-bold disabled:opacity-40 hover:bg-muted/40"
          >
            {s === "in_progress"
              ? "In progress"
              : s === "completed"
                ? "Mark deleted"
                : s === "rejected"
                  ? "Reject"
                  : "Reopen"}
          </button>
        ))}
      </div>
    </div>
  );
}
