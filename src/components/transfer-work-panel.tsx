import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserCheck } from "lucide-react";
import { toast } from "sonner";
import { listTransferExperts, transferCompletedWork } from "@/lib/handover.functions";

export function TransferWorkPanel({
  bookingId, status, currentExpertId, currentExpertName, canEdit,
}: {
  bookingId: string; status: string; currentExpertId: string | null; currentExpertName: string | null; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTransferExperts);
  const doFn = useServerFn(transferCompletedWork);
  const [open, setOpen] = useState(false);
  const [expertId, setExpertId] = useState("");
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const experts = useQuery({ queryKey: ["experts", "transfer-list"], queryFn: () => listFn(), enabled: open });

  const m = useMutation({
    mutationFn: () => doFn({ data: { bookingId, newExpertId: expertId, reason } }),
    onSuccess: (r) => {
      toast.success(`Work transferred to ${r.to ?? "expert"} · ₹${Math.round(r.amount)} · ${r.minutes} min`);
      setOpen(false); setExpertId(""); setReason(""); setSearch("");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["experts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Transfer failed"),
  });

  if (!canEdit || status !== "completed" || !currentExpertId) return null;
  const q = search.trim().toLowerCase();
  const list = (experts.data ?? []).filter((e) => e.id !== currentExpertId && (!q || e.name.toLowerCase().includes(q) || (e.phone ?? "").includes(q)));
  const picked = experts.data?.find((e) => e.id === expertId);

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-[13px] font-bold flex items-center gap-1.5"><UserCheck size={14} /> Transfer work done</h4>
        {!open && (
          <button onClick={() => setOpen(true)} className="text-[12px] font-bold text-primary hover:underline">
            Work was done by another expert
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">
            Earning and time for this order move from <b>{currentExpertName ?? "current expert"}</b> to the expert you pick. Not allowed if the order is already in a payout batch.
          </p>
          <div>
            <input placeholder="Search name / phone" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {experts.isLoading && <p className="text-[12px] text-muted-foreground">Loading…</p>}
              {list.map((e) => (
                <button key={e.id} onClick={() => setExpertId(e.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 text-[12px] ${expertId === e.id ? "border-primary bg-primary/10" : "border-border"}`}>
                  <b>{e.name}</b> <span className="text-muted-foreground">{e.phone}</span>
                </button>
              ))}
            </div>
          </div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Reason (required) e.g. Phone issue, work done by other maid"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-2 text-[12px] font-semibold">Cancel</button>
            <button disabled={!expertId || reason.trim().length < 3 || m.isPending}
              onClick={() => { if (confirm(`Transfer this order's earning and time from ${currentExpertName ?? "current expert"} to ${picked?.name ?? "selected expert"}?`)) m.mutate(); }}
              className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-[12px] font-bold disabled:opacity-50">
              {m.isPending ? "Saving…" : "Confirm transfer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
