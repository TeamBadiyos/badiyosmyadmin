import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Ban } from "lucide-react";
import { toast } from "sonner";
import {
  listPartnerSkillRequests,
  decidePartnerSkill,
  type SkillStatus,
} from "@/lib/partner-skills.functions";

type StaffRole = "super_admin" | "ops_manager" | "area_partner";

const STATUS_STYLES: Record<SkillStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

export function SkillApprovalsPage({ role }: { role: StaffRole | null }) {
  const canManage = role === "super_admin" || role === "ops_manager";
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SkillStatus | "">("pending");

  const fetchRows = useServerFn(listPartnerSkillRequests);
  const decide = useServerFn(decidePartnerSkill);

  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["partner-skills", "list", status],
    queryFn: () => fetchRows({ data: { status: status || null } }),
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: (p: { skillId: string; decision: "approved" | "rejected" }) =>
      decide({ data: p }),
    onSuccess: (_r, p) => {
      toast.success(`Skill ${p.decision}`);
      queryClient.invalidateQueries({ queryKey: ["partner-skills"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[14px] text-muted-foreground">
          Review skill requests submitted by partners.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SkillStatus | "")}
            className="h-10 px-3 rounded-[12px] border border-border bg-card text-[13px] min-w-[160px]"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[18px] overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_160px_110px_180px] gap-4 px-6 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Expert</span>
          <span>Phone</span>
          <span>Service category</span>
          <span>Requested</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>

        {isLoading && (
          <p className="text-[13px] text-muted-foreground text-center py-10">Loading…</p>
        )}
        {isError && (
          <p className="text-[13px] text-destructive text-center py-10">
            Failed to load skill requests.
          </p>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-10">
            No skill requests here.
          </p>
        )}

        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_160px_110px_180px] gap-4 items-center px-6 py-3 border-b border-border last:border-b-0 text-[14px]"
          >
            <span className="font-semibold text-foreground truncate">{r.expertName}</span>
            <span className="font-mono text-[13px] text-muted-foreground truncate">
              {r.expertPhone}
            </span>
            <span className="text-foreground truncate">{r.categoryName}</span>
            <span className="text-[13px] text-muted-foreground">
              {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </span>
            <span
              className={`justify-self-start text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${STATUS_STYLES[r.status]}`}
            >
              {r.status}
            </span>
            <div className="flex justify-end gap-2">
              {canManage && r.status === "pending" ? (
                <>
                  <button
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ skillId: r.id, decision: "approved" })}
                    className="h-9 px-3 rounded-[12px] bg-primary text-white font-bold text-[13px] inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ skillId: r.id, decision: "rejected" })}
                    className="h-9 px-3 rounded-[12px] border border-destructive text-destructive font-bold text-[13px] inline-flex items-center gap-1 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Ban size={14} /> Reject
                  </button>
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
