import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Native date picker that always DISPLAYS DD/MM/YYYY; value stays YYYY-MM-DD. */
export function toDMY(v: string | null | undefined) {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput({ className, value, style, ...rest }, ref) {
  const shown = toDMY(typeof value === "string" ? value : "");
  return (
    <span className="relative block w-full min-w-0">
      <input
        ref={ref}
        type="date"
        value={value}
        className={cn(className, "date-dmy")}
        style={{ ...style, color: "transparent" }}
        onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* ignore */ } }}
        {...rest}
      />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-foreground">
        {shown || <span className="text-muted-foreground">DD/MM/YYYY</span>}
      </span>
    </span>
  );
});
