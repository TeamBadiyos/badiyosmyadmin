import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listSlotOverrides, setSlotFull, setInstantBooking } from "@/lib/booking-settings.functions";

function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function hourLabel(h: number) {
  const f = (x: number) => `${x % 12 === 0 ? 12 : x % 12} ${x < 12 || x === 24 ? "AM" : "PM"}`;
  return `${f(h)} – ${f(h + 1)}`;
}
function ddmmyyyy(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function SlotAvailabilityTab() {
  const [date, setDate] = useState(istDate());
  const qc = useQueryClient();
  const listFn = useServerFn(listSlotOverrides);
  const fullFn = useServerFn(setSlotFull);
  const instFn = useServerFn(setInstantBooking);
  const q = useQuery({ queryKey: ["slot-overrides", date], queryFn: () => listFn({ data: { date } }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["slot-overrides"] });
  const slotMut = useMutation({
    mutationFn: (v: { hour: number; full: boolean }) => fullFn({ data: { date, ...v } }),
    onSuccess: (_r, v) => { toast.success(v.full ? "Slot marked fully booked" : "Slot re-opened"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const instMut = useMutation({
    mutationFn: (on: boolean) => instFn({ data: { on } }),
    onSuccess: (_r, on) => { toast.success(on ? "Book Now turned ON" : "Book Now paused"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  const hours: number[] = [];
  if (d) for (let h = d.first; h <= d.last; h++) hours.push(h);
  const fullSet = new Set((d?.full ?? []).map((f) => f.start_hour));

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-[16px] border border-border bg-card px-4 py-4">
        <div className="min-w-0 max-w-xl">
          <h3 className="text-[15px] font-bold text-foreground">Book Now (Instant) bookings</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            OFF: only "Book Now" is paused. Schedule Later slots stay open. Only Super Admin can change this.
          </p>
        </div>
        <button
          type="button" role="switch" aria-checked={!!d?.instantOn} aria-label="Instant booking"
          disabled={!d || instMut.isPending}
          onClick={() => d && (d.instantOn || true) && (confirm(d.instantOn ? "Pause Book Now (instant) orders?" : "Turn Book Now back ON?")) && instMut.mutate(!d.instantOn)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${d?.instantOn ? "bg-primary" : "bg-border"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${d?.instantOn ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </section>

      <section className="rounded-[16px] border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <h3 className="mr-auto text-[15px] font-bold text-foreground">Schedule Later slots · {ddmmyyyy(date)}</h3>
          {[0, 1, 2].map((o) => (
            <button key={o} type="button" onClick={() => setDate(istDate(o))}
              className={`rounded-[10px] px-3 py-1.5 text-[12px] font-semibold ${date === istDate(o) ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>
              {o === 0 ? "Today" : o === 1 ? "Tomorrow" : "Day after"}
            </button>
          ))}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-9 rounded-[10px] border border-border bg-card px-2 text-[12px] text-foreground" />
        </div>
        {q.isLoading ? <p className="p-4 text-[13px] text-muted-foreground">Loading slots…</p> : null}
        {q.isError ? <p className="p-4 text-[13px] text-destructive">{(q.error as Error).message}</p> : null}
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {hours.map((h) => {
            const full = fullSet.has(h);
            const count = d?.counts[h] ?? 0;
            return (
              <div key={h} className={`rounded-[12px] border p-3 ${full ? "border-destructive/50 bg-destructive/10" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-bold text-foreground">{hourLabel(h)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${full ? "bg-destructive text-destructive-foreground" : "bg-success/15 text-success"}`}>
                    {full ? "Fully Booked" : "Open"}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{count} booking{count === 1 ? "" : "s"} in this slot</p>
                {d?.canEdit ? (
                  <button type="button" disabled={slotMut.isPending}
                    onClick={() => slotMut.mutate({ hour: h, full: !full })}
                    className={`mt-2 h-9 w-full rounded-[10px] text-[12px] font-bold disabled:opacity-50 ${full ? "border border-border text-foreground" : "bg-destructive text-destructive-foreground"}`}>
                    {full ? "Re-open slot" : "Mark Fully Booked"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
