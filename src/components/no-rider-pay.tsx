import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCity } from "@/lib/city-scope";
import { getNoRiderMinutes, saveNoRiderMinutes, switchOffMerchantPay } from "@/lib/booking-settings.functions";

/** Booking rules: auto-cancel when no rider is found (per city). */
export function NoRiderMinutesBox({ service }: { service: "store" | "food" }) {
  const qc = useQueryClient();
  const { cityId } = useCity();
  const getFn = useServerFn(getNoRiderMinutes);
  const saveFn = useServerFn(saveNoRiderMinutes);
  const q = useQuery({ queryKey: ["no-rider-min", service, cityId], queryFn: () => getFn({ data: { service, cityId } }) });
  const [v, setV] = useState("");
  useEffect(() => { if (q.data) setV(String(q.data.minutes)); }, [q.data]);
  const m = useMutation({
    mutationFn: () => saveFn({ data: { service, cityId, minutes: Number(v) } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["no-rider-min"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const canEdit = !!q.data?.canEdit;
  return (
    <div className="max-w-xs space-y-1">
      <label className="text-sm font-medium">Auto-cancel if no rider found (min)</label>
      <div className="flex gap-2">
        <input type="number" min={5} max={240} disabled={!canEdit} value={v} onChange={(e) => setV(e.target.value)}
          className="h-9 w-28 rounded-md border bg-background px-2 text-sm" />
        {canEdit && <button disabled={m.isPending} onClick={() => m.mutate()} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">Save</button>}
      </div>
      <p className="text-xs text-muted-foreground">For this city. Default 30. The customer gets a full refund.</p>
    </div>
  );
}

/** Order detail: "Pay merchant" for orders that failed after the store accepted. */
export function MerchantPayOnFailure({ order, onDone }: { order: any; onDone?: () => void }) {
  const fn = useServerFn(switchOffMerchantPay);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: () => fn({ data: { orderId: order.id, reason } }),
    onSuccess: () => { toast.success("Merchant will not be paid for this order"); setOpen(false); onDone?.(); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!order?.failure_cause) return null;
  const on = !!order.merchant_pay_on_failure;
  const cause = order.failure_cause === "DELIVERY_FAILED" ? "Delivery failed" : "No rider found";
  return (
    <div className="rounded-md border p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span>{cause} · Pay merchant: <b>{on ? "On" : "Off"}</b></span>
        {on && !open && <button onClick={() => setOpen(true)} className="h-8 px-3 rounded-md border text-xs font-semibold">Switch off</button>}
      </div>
      {!on && order.merchant_pay_off_reason && <p className="text-xs text-muted-foreground">Reason: {order.merchant_pay_off_reason}</p>}
      {on && <p className="text-xs text-muted-foreground">The store accepted before it failed, so the merchant earns this order. The customer refund is a badiyos cost.</p>}
      {open && (
        <div className="flex gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="h-8 flex-1 rounded-md border bg-background px-2 text-xs" />
          <button disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()} className="h-8 px-3 rounded-md bg-destructive text-destructive-foreground text-xs font-semibold disabled:opacity-50">Confirm</button>
        </div>
      )}
    </div>
  );
}
