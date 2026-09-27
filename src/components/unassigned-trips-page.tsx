import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listUnassignedBusinessTrips, rejectBusinessTrip, type UnassignedTrip } from "@/lib/bulk-courier.functions";
import { listCourierOrders, type CourierOrderRow } from "@/lib/courier.functions";
import { OrderDetail } from "@/components/courier-page";
import { ReasonDialog } from "@/components/bulk-courier-page";
import type { StaffRole } from "@/lib/staff.functions";

const btn = "rounded-[10px] bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground disabled:opacity-40";
const btnDanger = "rounded-[10px] border border-destructive px-3 py-1.5 text-[12px] font-semibold text-destructive hover:bg-destructive/10";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground";
const td = "px-3 py-2 text-[13px] text-foreground";
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function UnassignedTripsPage({ role }: { role: StaffRole | null }) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listUnassignedBusinessTrips);
  const reject = useServerFn(rejectBusinessTrip);
  const fetchOrders = useServerFn(listCourierOrders);
  const [order, setOrder] = useState<CourierOrderRow | null>(null);
  const [rejecting, setRejecting] = useState<UnassignedTrip | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["bulk", "unassigned-trips"],
    queryFn: () => fetchList(),
    refetchInterval: 20_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["bulk"] });
    qc.invalidateQueries({ queryKey: ["courier", "orders"] });
  };
  const openAssign = async (id: string) => {
    try {
      const r = await fetchOrders({ data: { orderId: id } });
      if (r[0]) setOrder(r[0]); else toast.error("Courier order not found");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  const rows = data ?? [];
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">Bulk Courier trips that were dispatched but no rider has taken yet.</p>
      {error ? <p className="text-[13px] text-destructive">{(error as Error).message}</p> : null}
      <div className="overflow-x-auto rounded-[14px] border border-border bg-card">
        <table className="w-full">
          <thead className="bg-muted/40"><tr>{["Business", "Trip", "Drops", "Fare", "Waiting", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => (
              <tr key={t.courier_order_id}>
                <td className={`${td} font-semibold`}>{t.business_name}</td>
                <td className={td}>{t.trip_no != null ? `Trip ${t.trip_no}` : "Trip"}{t.trip_label ? ` · ${t.trip_label}` : ""} <span className="font-mono text-[11px] text-muted-foreground">{t.order_code ?? `#${t.courier_order_id.slice(0, 8)}`}</span></td>
                <td className={td}>{t.drops}</td>
                <td className={td}>{inr(t.total_amount)}</td>
                <td className={td}>{t.search_started_at ? ago(t.search_started_at) : "—"}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <div className="flex justify-end gap-2">
                    <button className={btn} onClick={() => openAssign(t.courier_order_id)}>Assign rider</button>
                    <button className={btnDanger} onClick={() => setRejecting(t)}>Reject</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 ? <p className="p-4 text-[13px] text-muted-foreground">No unassigned business trips.</p> : null}
        {isLoading ? <p className="p-4 text-[13px] text-muted-foreground">Loading…</p> : null}
      </div>
      {order ? <OrderDetail order={order} canWrite={role === "super_admin"} onClose={() => setOrder(null)} onChanged={() => { setOrder(null); refresh(); }} /> : null}
      {rejecting ? (
        <ReasonDialog
          title={`Reject trip ${rejecting.trip_no ?? ""} — ${rejecting.business_name}`}
          confirmLabel="Reject trip"
          body={<p className="rounded-[10px] bg-warning/10 p-3 text-[13px] text-foreground">Orders go back to pending and join the next slot. Wallet will be refunded.</p>}
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await reject({ data: { courier_order_id: rejecting.courier_order_id, reason } });
            toast.success("Trip rejected");
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
