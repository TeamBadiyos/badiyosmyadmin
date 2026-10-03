export function ExpertModeBadge({ mode }: { mode: "TRAINING" | "LIVE" | string | null | undefined }) {
  const training = String(mode ?? "").toUpperCase() === "TRAINING";
  return (
    <span
      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
        training ? "bg-warning/25 text-foreground border border-warning/50" : "bg-primary/10 text-primary border border-primary/30"
      }`}
    >
      {training ? "Training" : "Live"}
    </span>
  );
}
