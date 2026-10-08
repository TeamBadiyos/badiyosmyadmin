import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getExpertGrowthPartner, listGrowthPartners, setExpertGrowthPartner } from "@/lib/partner-program.functions";

export function ExpertGrowthPartnerCard({ expertId, canChange }: { expertId: string; canChange: boolean }) {
  const qc = useQueryClient();
  const fetchCur = useServerFn(getExpertGrowthPartner);
  const fetchList = useServerFn(listGrowthPartners);
  const save = useServerFn(setExpertGrowthPartner);
  const cur = useQuery({ queryKey: ["expert-growth-partner", expertId], queryFn: () => fetchCur({ data: { expertId } }) });
  const list = useQuery({ queryKey: ["growth-partners"], queryFn: () => fetchList() });
  const m = useMutation({
    mutationFn: (partnerId: string | null) => save({ data: { expertId, partnerId } }),
    onSuccess: () => {
      toast.success("Partner updated");
      qc.invalidateQueries({ queryKey: ["expert-growth-partner", expertId] });
      qc.invalidateQueries({ queryKey: ["partner-program"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const value = cur.data?.partnerId ?? "";
  const name = list.data?.find((p) => p.id === value)?.name;
  return (
    <section className="rounded-[14px] border border-border p-3">
      <p className="text-[11px] font-bold uppercase text-muted-foreground">Onboarded by Partner</p>
      {canChange ? (
        <select
          className="mt-2 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          value={value}
          disabled={m.isPending || cur.isLoading}
          onChange={(e) => m.mutate(e.target.value || null)}
        >
          <option value="">— None —</option>
          {(list.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.level}{p.status !== "active" ? " (inactive)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <p className="mt-1 text-sm font-semibold">{name ?? "None"}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        Earns for 12 months from this Expert's first completed order; stops after 30 days with no completed order.
      </p>
    </section>
  );
}
