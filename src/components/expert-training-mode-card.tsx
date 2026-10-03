import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExpertModeBadge } from "@/components/expert-mode-badge";
import { setExpertMode } from "@/lib/training.functions";

export function ExpertTrainingModeCard({
  expertId,
  name,
  mode,
  ordersCompleted,
  completedAt,
  canChange,
}: {
  expertId: string;
  name: string;
  mode: "TRAINING" | "LIVE";
  ordersCompleted: number;
  completedAt: string | null;
  canChange: boolean;
}) {
  const qc = useQueryClient();
  const run = useServerFn(setExpertMode);
  const [open, setOpen] = useState(false);
  const next = mode === "TRAINING" ? "LIVE" : "TRAINING";
  const mut = useMutation({
    mutationFn: () => run({ data: { expertId, mode: next } }),
    onSuccess: () => {
      toast.success(next === "LIVE" ? `${name} is now Live` : `${name} moved to Training`);
      qc.invalidateQueries({ queryKey: ["experts"] });
      qc.invalidateQueries({ queryKey: ["training"] });
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again."),
  });

  return (
    <section className="rounded-[14px] border border-border p-3 flex flex-wrap items-center gap-3 justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Mode</span>
          <ExpertModeBadge mode={mode} />
        </div>
        <p className="text-[13px]">
          Training orders completed: <b>{ordersCompleted}</b>
        </p>
        {completedAt && (
          <p className="text-[13px] text-muted-foreground">
            Went live on{" "}
            {new Date(completedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        )}
      </div>
      {canChange && (
        <button
          onClick={() => setOpen(true)}
          className={`h-10 px-4 rounded-[10px] text-[13px] font-bold ${
            next === "LIVE" ? "bg-primary text-primary-foreground" : "border border-border bg-card"
          }`}
        >
          {next === "LIVE" ? "Make Live" : "Move to Training"}
        </button>
      )}
      <AlertDialog open={open} onOpenChange={(o) => !mut.isPending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next === "LIVE" ? "Make this expert Live?" : "Move this expert to Training?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {next === "LIVE"
                ? `${name} will start getting real customer orders.`
                : `${name} will stop getting real customer orders and only get training orders.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mut.isPending}
              onClick={(e) => {
                e.preventDefault();
                mut.mutate();
              }}
            >
              {mut.isPending ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
