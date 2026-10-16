import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCity } from "@/lib/city-scope";
import { DEFAULT_CANCEL_POLICY, getCancelRules, saveCancelRules, type CapGroup } from "@/lib/booking-settings.functions";

const btn = "h-10 rounded-[10px] bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50 whitespace-nowrap";

function useRules(group: CapGroup) {
  const { cityId } = useCity();
  const getFn = useServerFn(getCancelRules);
  return { cityId, q: useQuery({ queryKey: ["cancel-rules", group, cityId], queryFn: () => getFn({ data: { group, cityId } }) }) };
}

/** Booking rules: cancellation fee % and the after-arrival rule. */
export function CancelFeeRows({ group }: { group: CapGroup }) {
  const qc = useQueryClient();
  const { cityId, q } = useRules(group);
  const saveFn = useServerFn(saveCancelRules);
  const [pct, setPct] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (v: { feePercent?: number; noRefundAfterArrived?: boolean }) => saveFn({ data: { group, cityId, ...v } }),
    onSuccess: () => { toast.success("Saved"); setPct(null); qc.invalidateQueries({ queryKey: ["cancel-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = q.data;
  const on = !!d?.noRefundAfterArrived;
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">Fee after expert assigned</p><p className="text-[12px] text-muted-foreground">Share of the amount paid (incl. GST) kept when the customer cancels after assignment; the rest is refunded.</p></div>
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={100} aria-label="Fee after expert assigned" value={pct ?? (d ? String(d.feePercent) : "")} onChange={(e) => setPct(e.target.value)}
            className="h-10 w-24 rounded-[10px] border border-border bg-card px-3 text-[14px] text-foreground" />
          <span className="text-[12px] text-muted-foreground">%</span>
          <button className={btn} disabled={pct == null || pct === "" || mut.isPending || d?.canEdit === false} onClick={() => mut.mutate({ feePercent: Number(pct) })}>Save</button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 py-4">
        <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">No refund after expert arrived</p><p className="text-[12px] text-muted-foreground">When on, cancelling after the expert has arrived gives no refund.</p></div>
        <button type="button" role="switch" aria-checked={on} aria-label="No refund after expert arrived" disabled={!d || mut.isPending || d.canEdit === false}
          onClick={() => mut.mutate({ noRefundAfterArrived: !on })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-primary" : "bg-border"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
    </>
  );
}

/** Customer messages: cancellation policy text shown in the Customer App. */
export function CancelPolicyEditor({ group }: { group: CapGroup }) {
  const qc = useQueryClient();
  const { cityId, q } = useRules(group);
  const saveFn = useServerFn(saveCancelRules);
  const [en, setEn] = useState("");
  const [mr, setMr] = useState("");
  useEffect(() => { if (q.data) { setEn(q.data.policy.en.join("\n")); setMr(q.data.policy.mr.join("\n")); } }, [q.data]);
  const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
  const mut = useMutation({
    mutationFn: (p: { en: string[]; mr: string[] }) => saveFn({ data: { group, cityId, policy: p } }),
    onSuccess: () => { toast.success("Policy saved"); qc.invalidateQueries({ queryKey: ["cancel-rules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ta = "w-full min-h-[150px] rounded-[10px] border border-border bg-card p-3 text-[13px] text-foreground";
  return (
    <section className="rounded-[16px] border border-border bg-card p-4">
      <h3 className="text-[15px] font-bold text-foreground">Cancellation policy</h3>
      <p className="text-[12px] text-muted-foreground">Shown to customers before they cancel. One rule per line. {"{fee_percent}"} and {"{auto_cancel_minutes}"} are filled in with this city's numbers.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block text-[12px] font-semibold text-muted-foreground">English<textarea className={ta} value={en} onChange={(e) => setEn(e.target.value)} /></label>
        <label className="block text-[12px] font-semibold text-muted-foreground">मराठी<textarea className={ta} value={mr} onChange={(e) => setMr(e.target.value)} /></label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="h-10 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground"
          onClick={() => { setEn(DEFAULT_CANCEL_POLICY.en.join("\n")); setMr(DEFAULT_CANCEL_POLICY.mr.join("\n")); }}>Use default text</button>
        <button className={btn} disabled={mut.isPending || q.data?.canEdit === false} onClick={() => mut.mutate({ en: lines(en), mr: lines(mr) })}>Save</button>
      </div>
    </section>
  );
}
