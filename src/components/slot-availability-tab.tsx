import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listSlotOverrides, setSlotFull, setInstantBooking, getSlotCapacity, setDailyCapacity, setCapacitySetting } from "@/lib/booking-settings.functions";

function istDate(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function slotLabel(m: number, step: number) {
  const f = (x: number) => {
    const h = Math.floor(x / 60), mi = x % 60;
    return `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
  };
  void step;
  return f(m);
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
    mutationFn: (v: { hour: number; minute: number; full: boolean }) => fullFn({ data: { date, ...v } }),
    onSuccess: (_r, v) => { toast.success(v.full ? "Slot marked fully booked" : "Slot re-opened"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const instMut = useMutation({
    mutationFn: (on: boolean) => instFn({ data: { on } }),
    onSuccess: (_r, on) => { toast.success(on ? "Book Now turned ON" : "Book Now paused"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const capFn = useServerFn(getSlotCapacity);
  const dayCapFn = useServerFn(setDailyCapacity);
  const setFn = useServerFn(setCapacitySetting);
  const cq = useQuery({ queryKey: ["slot-overrides", "cap", date], queryFn: () => capFn({ data: { date } }) });
  const [dayInput, setDayInput] = useState("");
  const [defInput, setDefInput] = useState("");
  const capMut = useMutation({
    mutationFn: (capacity: number | null) => dayCapFn({ data: { date, capacity } }),
    onSuccess: () => { toast.success("Maid count saved"); setDayInput(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setMut = useMutation({
    mutationFn: (v: { key: "slot_capacity_enabled" | "default_slot_capacity" | "slot_capacity_mode"; value: string }) => setFn({ data: v }),
    onSuccess: () => { toast.success("Saved"); setDefInput(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cap = cq.data;

  const d = q.data;
  const step = d?.step ?? 30;
  const hours: number[] = [];
  if (d) for (let m = d.first * 60; m <= d.last * 60; m += step) hours.push(m);
  const fullSet = new Set((d?.full ?? []).map((f) => f.key));

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

      <section className="space-y-3 rounded-[16px] border border-border bg-card px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <h3 className="text-[15px] font-bold text-foreground">Automatic slot capacity</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              ON: a slot shows Fully Booked by itself when all maids are busy. Long bookings (e.g. 3 hours) keep one maid busy in every half-hour they cover (plus travel gap). Only Super Admin can change these settings.
            </p>
          </div>
          <button type="button" role="switch" aria-checked={!!cap?.enabled} aria-label="Automatic capacity"
            disabled={!cap || setMut.isPending}
            onClick={() => cap && confirm(cap.enabled ? "Turn automatic capacity OFF?" : "Turn automatic capacity ON?") && setMut.mutate({ key: "slot_capacity_enabled", value: cap.enabled ? "0" : "1" })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${cap?.enabled ? "bg-primary" : "bg-border"}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${cap?.enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[12px] border border-border p-3">
            <p className="text-[12px] font-semibold text-muted-foreground">Maid count source</p>
            <div className="mt-2 flex gap-2">
              {(["manual", "live"] as const).map((m) => (
                <button key={m} type="button" disabled={setMut.isPending}
                  onClick={() => cap && cap.mode !== m && setMut.mutate({ key: "slot_capacity_mode", value: m })}
                  className={`rounded-[10px] px-3 py-1.5 text-[12px] font-semibold ${cap?.mode === m ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>
                  {m === "manual" ? "Manual entry" : "Live online experts"}
                </button>
              ))}
            </div>
            {cap?.mode === "live" ? <p className="mt-1 text-[11px] text-muted-foreground">Today uses online experts; future days use the expected count.</p> : null}
          </div>
          <div className="rounded-[12px] border border-border p-3">
            <p className="text-[12px] font-semibold text-muted-foreground">Expected maids (all future days)</p>
            <div className="mt-2 flex gap-2">
              <input type="number" min={0} max={500} placeholder={String(cap?.defaultCap ?? "")} value={defInput} onChange={(e) => setDefInput(e.target.value)}
                className="h-9 w-20 rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground" />
              <button type="button" disabled={!defInput || setMut.isPending} onClick={() => setMut.mutate({ key: "default_slot_capacity", value: defInput })}
                className="h-9 rounded-[10px] bg-primary px-3 text-[12px] font-bold text-primary-foreground disabled:opacity-50">Save</button>
            </div>
          </div>
          <div className="rounded-[12px] border border-border p-3">
            <p className="text-[12px] font-semibold text-muted-foreground">Maids on {ddmmyyyy(date)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input type="number" min={0} max={500} placeholder={String(cap?.capacity ?? "")} value={dayInput} onChange={(e) => setDayInput(e.target.value)}
                className="h-9 w-20 rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground" />
              <button type="button" disabled={!dayInput || capMut.isPending || !d?.canEdit} onClick={() => capMut.mutate(Number(dayInput))}
                className="h-9 rounded-[10px] bg-primary px-3 text-[12px] font-bold text-primary-foreground disabled:opacity-50">Save</button>
              {cap?.dayCap != null ? (
                <button type="button" disabled={capMut.isPending} onClick={() => capMut.mutate(null)}
                  className="h-9 rounded-[10px] border border-border px-3 text-[12px] font-semibold text-foreground">Use expected</button>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {cap ? (cap.dayCap != null ? `Set for this day: ${cap.dayCap}` : `Using expected count: ${cap.capacity}`) : ""}
            </p>
          </div>
        </div>
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
            const busy = Math.max(cap?.busy[h] ?? 0, step === 60 ? cap?.busy[h + 30] ?? 0 : 0);
            const autoFull = !!cap?.enabled && busy >= (cap?.capacity ?? 0);
            const manualFull = fullSet.has(h);
            const full = manualFull || autoFull;
            const count = (d?.counts[h] ?? 0) + (step === 60 ? d?.counts[h + 30] ?? 0 : 0);
            return (
              <div key={h} className={`rounded-[12px] border p-3 ${full ? "border-destructive/50 bg-destructive/10" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-bold text-foreground">{slotLabel(h, step)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${full ? "bg-destructive text-destructive-foreground" : "bg-success/15 text-success"}`}>
                    {manualFull ? "Fully Booked" : autoFull ? "Auto Full" : "Open"}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">{count} booking{count === 1 ? "" : "s"} start here · {busy} / {cap?.capacity ?? "–"} maids busy</p>
                {d?.canEdit ? (
                  <button type="button" disabled={slotMut.isPending}
                    onClick={() => slotMut.mutate({ hour: Math.floor(h / 60), minute: h % 60, full: !manualFull })}
                    className={`mt-2 h-9 w-full rounded-[10px] text-[12px] font-bold disabled:opacity-50 ${full ? "border border-border text-foreground" : "bg-destructive text-destructive-foreground"}`}>
                    {manualFull ? "Re-open slot" : "Mark Fully Booked"}
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
