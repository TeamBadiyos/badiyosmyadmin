import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTrainingSetup } from "@/lib/training.functions";
import { TrainingAddressCard } from "@/components/training-address-card";

export function TrainingAddressTab() {
  const fetchSetup = useServerFn(getTrainingSetup);
  const q = useQuery({ queryKey: ["training", "setup"], queryFn: () => fetchSetup() });
  if (q.isLoading) return <p className="text-[13px] text-muted-foreground">Loading…</p>;
  if (q.isError || !q.data)
    return <p className="text-[13px] text-destructive">Couldn't load the training address.</p>;
  return <TrainingAddressCard initial={q.data.address} canEdit={q.data.role === "super_admin"} />;
}
