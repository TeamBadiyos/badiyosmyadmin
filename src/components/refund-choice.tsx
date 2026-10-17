export type RefundMode = "full" | "partial" | "none";

/** Staff cancel: choose Full / Partial (₹) / No refund. Wallet part is returned first on partial. */
export function RefundChoice({
  mode, onMode, amount, onAmount,
}: { mode: RefundMode; onMode: (m: RefundMode) => void; amount: string; onAmount: (v: string) => void }) {
  const opts: [RefundMode, string][] = [["full", "Full refund"], ["partial", "Partial"], ["none", "No refund"]];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {opts.map(([k, l]) => (
          <button key={k} type="button" onClick={() => onMode(k)}
            className={`h-8 px-3 rounded-full border text-[12px] font-semibold ${mode === k ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground"}`}>
            {l}
          </button>
        ))}
      </div>
      {mode === "partial" && (
        <input type="number" min={1} step="0.01" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="Refund amount ₹"
          className="h-9 w-40 rounded-[10px] border border-border bg-background px-3 text-[13px]" />
      )}
      <p className="text-[12px] text-muted-foreground">
        {mode === "full" ? "Wallet part goes back to the wallet now; online part to the original payment method."
          : mode === "partial" ? "Up to the amount paid. Wallet part is returned first, then the online part."
          : "The order is cancelled and nothing is refunded."}
      </p>
    </div>
  );
}
