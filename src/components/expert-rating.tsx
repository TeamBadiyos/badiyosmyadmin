import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star } from "lucide-react";
import { listExpertRatingMap } from "@/lib/experts.functions";

export function useExpertRatings() {
  const fetchMap = useServerFn(listExpertRatingMap);
  const { data } = useQuery({
    queryKey: ["experts", "rating-map"],
    queryFn: () => fetchMap(),
    staleTime: 5 * 60_000,
  });
  return data ?? {};
}

/** Small ★ avg pill shown beside an expert's name anywhere in the Command Center. */
export function ExpertRatingPill({ expertId, className = "" }: { expertId: string | null | undefined; className?: string }) {
  const map = useExpertRatings();
  if (!expertId) return null;
  const r = map[expertId];
  if (!r) return null;
  return (
    <span
      title={`${r.avg.toFixed(1)} average from ${r.count} rating${r.count === 1 ? "" : "s"}`}
      className={`inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-foreground whitespace-nowrap ${className}`}
    >
      <Star className="h-2.5 w-2.5 fill-warning text-warning" />
      {r.avg.toFixed(1)}
      <span className="text-muted-foreground font-normal">({r.count})</span>
    </span>
  );
}
