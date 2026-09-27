import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLeftBehindToday, getTripLeftBehind } from "@/lib/left-behind.functions";

const inr = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const cap = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const time = (s: string) => new Date(s).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export function TripLeftBehind({ courierOrderId }: { courierOrderId: string }) {
  const fn = useServerFn(getTripLeftBehind);
  const { data, error } = useQuery({ queryKey: ["bulk", "left-behind", courierOrderId], queryFn: () => fn({ data: { courier_order_id: courierOrderId } }) });
  if (error) return <p className="text-[12px] text-destructive">{(error as Error).message}</p>;
  if (!data || data.removals.length === 0) return null;
  const n = data.removals.reduce((s, r) => s + r.packets.length, 0);
  return (
    <div className="rounded-[12px] border border-border p-3">
      <h4 className="text-[13px] font-bold text-foreground">Left behind{data.trip_no != null ? ` · T${data.trip_no}` : ""} <span className="font-normal text-muted-foreground">({n} packet{n === 1 ? "" : "s"})</span></h4>
      <div className="mt-2 space-y-3">
        {data.removals.map((r) => (
          <div key={r.removal_id} className="rounded-[10px] border border-border p-2.5 text-[12px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <span>{time(r.removed_at)}</span>
              <span>Fare <b className="text-foreground">{inr(r.fare_before)}</b> → <b className="text-foreground">{inr(r.fare_after)}</b></span>
              <span>Refund <b className="text-primary">{inr(r.refund)}</b></span>
              {r.trip_cancelled ? <span className="font-semibold text-warning">All packets removed · trip cancelled</span> : null}
            </div>
            <table className="mt-2 w-full">
              <thead><tr className="text-left text-[11px] uppercase text-muted-foreground"><th className="py-1">Sticker</th><th>Drop</th><th>Receiver</th><th>Reason</th><th>Removed by</th><th>Time</th></tr></thead>
              <tbody>
                {r.packets.map((p) => (
                  <tr key={p.code} className="border-t border-border">
                    <td className="py-1 font-semibold">{p.printed}</td>
                    <td>{p.drop_label ?? "—"}</td>
                    <td>{p.receiver ?? "—"}</td>
                    <td>{cap(p.reason)}{p.notes ? <span className="block text-muted-foreground">{p.notes}</span> : null}</td>
                    <td>{p.removed_by_label}</td>
                    <td>{time(p.removed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LeftBehindTodayCard({ merchantId }: { merchantId: string }) {
  const fn = useServerFn(getLeftBehindToday);
  const { data, error } = useQuery({ queryKey: ["bulk", "left-behind-today", merchantId], queryFn: () => fn({ data: { merchant_id: merchantId } }) });
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-foreground">
        Left behind today: {data?.total ?? "…"}
        {data?.high ? <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-bold text-destructive">Over 10% of packets</span> : null}
      </div>
      {error ? <p className="text-[12px] text-destructive">{(error as Error).message}</p> : !data ? <p className="text-[12px] text-muted-foreground">Loading…</p> : data.total === 0 ? (
        <p className="text-[12px] text-muted-foreground">No packets left behind today ({data.packetsToday} packets on trips).</p>
      ) : (
        <div className="space-y-2 text-[12px]">
          <p className="text-muted-foreground">{data.total} of {data.packetsToday} packets today</p>
          <div className="flex flex-wrap gap-1.5">{data.byReason.map((r) => <span key={r.key} className="rounded-full bg-muted px-2 py-0.5">{cap(r.key)}: <b>{r.count}</b></span>)}</div>
          <div className="flex flex-wrap gap-1.5">{data.byActor.map((r) => <span key={r.key} className="rounded-full bg-muted px-2 py-0.5">{r.key === "rider" ? "Rider" : r.key === "business" ? "Business" : cap(r.key)}: <b>{r.count}</b></span>)}</div>
        </div>
      )}
    </div>
  );
}
