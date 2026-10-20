const LABEL: Record<string, string> = { pickup: "Pickup OTP", drop: "Drop OTP", return: "Return OTP" };

/** Shows each delivery stop's OTP, or when it will appear. */
export function TrainingOtpChips({ otps, emptyText }: { otps: { type: string; otp: string | null }[]; emptyText?: string }) {
  if (!otps.length) return emptyText ? <p className="text-[12px] text-muted-foreground">{emptyText}</p> : null;
  return (
    <div className="flex gap-2 flex-wrap mt-1">
      {otps.map((s, i) => (
        <span key={i} className="text-[12px] rounded-[8px] border border-border px-2 py-0.5">
          {LABEL[s.type] ?? "OTP"}:{" "}
          {s.otp ? <b className="font-mono text-[14px] text-foreground">{s.otp}</b> : <span className="text-muted-foreground">shows when rider reaches</span>}
        </span>
      ))}
    </div>
  );
}
