import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listSlotOverrides, setInstantBooking, getSlotCapacity, setBandCapacity, setCapacitySetting,
  type CapGroup, type CapKey, type Band,
} from "@/lib/booking-settings.functions";

function istDate(offsetDays = 0) {
  return new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
function hm(m: number) {
  const h = Math.floor(m / 60), mi = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
function slotMinutes(slot: string | null): number | null {
  const x = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(slot ?? "");
  if (!x) return null;
  let h = Number(x[1]) % 12;
  if (x[3].toUpperCase() === "PM") h += 12;
  return h * 60 + Number(x[2] ?? 0);
}
const BAND_LABEL = { morning: "Morning", day: "Day", evening: "Evening" } as const;

const card = "rounded-[16px] border border-border bg-card p-5";
const inputCls = "h-10 w-24 rounded-[10px] border border-border bg-card px-3 text-[14px] text-foreground";
const primaryBtn = "h-10 rounded-[10px] bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50 whitespace-nowrap";

function useCap(group: CapGroup, date: string) {
  const capFn = useServerFn(getSlotCapacity);
  return useQuery({ queryKey: ["slot-cap", group, date], queryFn: () => capFn({ data: { date, group } }) });
}

export function SlotAvailabilityTab({ group = "clean" }: { group?: CapGroup } = {}) {
  const isWash = group === "wash";
  const Who = isWash ? "Washers" : "Maids";
  const [date, setDate] = useState(istDate());
  const [openBand, setOpenBand] = useState<Band | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["slot-cap", group] });
  const cq = useCap(group, date);
  const cap = cq.data;

  const setFn = useServerFn(setCapacitySetting);
  const bandFn = useServerFn(setBandCapacity);
  const [defInput, setDefInput] = useState("");
  const defMut = useMutation({
    mutationFn: (v: string) => setFn({ data: { key: isWash ? "wash_default_slot_capacity" : "default_slot_capacity", value: v } }),
    onSuccess: () => { toast.success("Saved"); setDefInput(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [ovDate, setOvDate] = useState(istDate(1));
  const ov = useCap(group, ovDate);
  const [ovIn, setOvIn] = useState<Record<string, string>>({});
  const ovMut = useMutation({
    mutationFn: (clear: boolean) => {
      const n = (k: string) => {
        const v = ovIn[k] ?? String(ov.data?.bands.find((b) => b.band === k)?.override ?? "");
        return clear || v === "" ? null : Number(v);
      };
      return bandFn({ data: { date: ovDate, group, morning: n("morning"), day: n("day"), evening: n("evening") } });
    },
    onSuccess: () => { toast.success("Date saved"); setOvIn({}); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <section className={card}>
        <h3 className="text-[15px] font-bold text-foreground">{Who} per day</h3>
        <div className="mt-3 flex items-center gap-2">
          <input type="number" min={0} max={500} placeholder={String(cap?.defaultCap ?? "")} value={defInput}
            onChange={(e) => setDefInput(e.target.value)} className={inputCls} />
          <button disabled={!defInput || defMut.isPending} onClick={() => defMut.mutate(defInput)} className={primaryBtn}>Save</button>
          <span className="text-[12px] text-muted-foreground">Now: {cap?.defaultCap ?? "–"} · used every day by default</span>
        </div>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-[15px] font-bold text-foreground">Slots</h3>
          {[0, 1].map((o) => (
            <button key={o} onClick={() => setDate(istDate(o))}
              className={`h-9 rounded-[10px] px-3 text-[13px] font-semibold whitespace-nowrap ${date === istDate(o) ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>
              {o === 0 ? "Today" : "Tomorrow"}
            </button>
          ))}
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-9 rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground" />
        </div>
        {cq.isError && <p className="mt-3 text-[13px] text-destructive">{(cq.error as Error).message}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(cap?.bands ?? []).map((b) => (
            <button key={b.band} onClick={() => setOpenBand(b)}
              className={`rounded-[14px] border p-4 text-left transition-colors ${b.full ? "border-destructive/40 bg-destructive/10" : "border-success/40 bg-success/10"}`}>
              <p className="text-[13px] font-semibold text-muted-foreground whitespace-nowrap">
                {BAND_LABEL[b.band]} · {hm(b.start_min)}–{b.end_min >= 1440 ? "24:00" : hm(b.end_min)}
              </p>
              <p className={`mt-1 text-[24px] font-bold ${b.full ? "text-destructive" : "text-success"}`}>{b.booked} / {b.capacity}</p>
              <p className="text-[12px] text-muted-foreground">{b.full ? "Full" : "Open"}{b.override != null ? " · set for this date" : ""}</p>
            </button>
          ))}
        </div>
      </section>

      <section className={card}>
        <h3 className="text-[15px] font-bold text-foreground">Change a specific date</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <input type="date" value={ovDate} onChange={(e) => { if (e.target.value) { setOvDate(e.target.value); setOvIn({}); } }}
            className="h-10 rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground" />
          {(["morning", "day", "evening"] as const).map((k) => {
            const b = ov.data?.bands.find((x) => x.band === k);
            return (
              <label key={k} className="space-y-1">
                <span className="block text-[12px] font-semibold text-muted-foreground">{BAND_LABEL[k]}</span>
                <input type="number" min={0} max={500} className={inputCls}
                  placeholder={String(b?.capacity ?? "")}
                  value={ovIn[k] ?? (b?.override != null ? String(b.override) : "")}
                  onChange={(e) => setOvIn((x) => ({ ...x, [k]: e.target.value }))} />
              </label>
            );
          })}
          <button disabled={ovMut.isPending} onClick={() => ovMut.mutate(false)} className={primaryBtn}>Save</button>
          {ov.data?.bands.some((b) => b.override != null) && (
            <button disabled={ovMut.isPending} onClick={() => ovMut.mutate(true)} className="h-10 text-[13px] font-semibold text-muted-foreground underline whitespace-nowrap">Reset</button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Empty = use the daily number.</p>
      </section>

      {openBand && <BandBookings group={group} date={date} band={openBand} onClose={() => setOpenBand(null)} />}
    </div>
  );
}

function BandBookings({ group, date, band, onClose }: { group: CapGroup; date: string; band: Band; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["band-bookings", group, date],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings")
        .select("id, scheduled_time_slot, status, service_label, service_category_id, service_categories(slug)")
        .eq("scheduled_date", date).neq("status", "cancelled");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Array<{ id: string; scheduled_time_slot: string | null; status: string; service_label: string | null; service_categories: { slug: string } | null }>;
    },
  });
  const rows = (q.data ?? []).filter((r) => {
    const isW = r.service_categories?.slug === "car-bike-wash";
    if ((group === "wash") !== isW) return false;
    const m = slotMinutes(r.scheduled_time_slot);
    return m != null && m >= band.start_min && m < band.end_min;
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-foreground">{BAND_LABEL[band.band]} · {rows.length} bookings</h3>
          <button onClick={onClose} className="text-[13px] font-semibold text-muted-foreground">Close</button>
        </div>
        {q.isLoading && <p className="mt-4 text-[13px] text-muted-foreground">Loading…</p>}
        {q.isError && <p className="mt-4 text-[13px] text-destructive">{(q.error as Error).message}</p>}
        <div className="mt-4 space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-[12px] border border-border p-3">
              <p className="text-[14px] font-semibold text-foreground truncate">{r.service_label ?? "Booking"}</p>
              <p className="text-[12px] text-muted-foreground truncate">{r.id.slice(0, 8)} · {r.scheduled_time_slot} · {r.status}</p>
            </div>
          ))}
          {!q.isLoading && rows.length === 0 && <p className="text-[13px] text-muted-foreground">No bookings.</p>}
        </div>
      </div>
    </div>
  );
}

function Switch({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Settings tab: Book Now, automatic capacity, count source, band times. */
export function CleanCapacitySettings({ group = "clean" }: { group?: CapGroup }) {
  const isWash = group === "wash";
  const qc = useQueryClient();
  const listFn = useServerFn(listSlotOverrides);
  const instFn = useServerFn(setInstantBooking);
  const setFn = useServerFn(setCapacitySetting);
  const today = istDate();
  const q = useQuery({ queryKey: ["slot-overrides", today], queryFn: () => listFn({ data: { date: today } }) });
  const cq = useCap(group, today);
  const cap = cq.data;
  const d = q.data;
  const instOn = isWash ? d?.washInstantOn : d?.instantOn;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["slot-cap"] }); qc.invalidateQueries({ queryKey: ["slot-overrides"] }); };
  const instMut = useMutation({
    mutationFn: (on: boolean) => instFn({ data: { on, group } }),
    onSuccess: () => { toast.success("Saved"); refresh(); }, onError: (e: Error) => toast.error(e.message),
  });
  const setMut = useMutation({
    mutationFn: (v: { key: CapKey; value: string }) => setFn({ data: v }),
    onSuccess: () => { toast.success("Saved"); refresh(); }, onError: (e: Error) => toast.error(e.message),
  });
  const [me, setMe] = useState(""); const [de, setDe] = useState("");
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

  const row = "flex items-center justify-between gap-4 py-4";
  return (
    <section className={`${card} divide-y divide-border py-1`}>
      <div className={row}>
        <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">Book Now</p><p className="text-[12px] text-muted-foreground">{isWash ? "Instant Clean Auto bookings" : "Instant Clean Home bookings"}</p></div>
        <Switch label="Book Now" on={!!instOn} disabled={!d || instMut.isPending}
          onClick={() => d && confirm(instOn ? "Pause Book Now?" : "Turn Book Now ON?") && instMut.mutate(!instOn)} />
      </div>
      <div className={row}>
        <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">Automatic capacity</p><p className="text-[12px] text-muted-foreground">Slots close by themselves when full</p></div>
        <Switch label="Automatic capacity" on={!!cap?.enabled} disabled={!cap || setMut.isPending}
          onClick={() => cap && confirm(cap.enabled ? "Turn automatic capacity OFF?" : "Turn automatic capacity ON?") && setMut.mutate({ key: "slot_capacity_enabled", value: cap.enabled ? "0" : "1" })} />
      </div>
      {!isWash && (
        <div className={row}>
          <p className="text-[14px] font-semibold text-foreground">Count source</p>
          <div className="flex gap-2">
            {(["manual", "live"] as const).map((m) => (
              <button key={m} disabled={setMut.isPending} onClick={() => cap && cap.mode !== m && setMut.mutate({ key: "slot_capacity_mode", value: m })}
                className={`h-9 rounded-[10px] px-3 text-[13px] font-semibold whitespace-nowrap ${cap?.mode === m ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>
                {m === "manual" ? "Manual" : "Live online"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={row}>
        <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">Time bands</p><p className="text-[12px] text-muted-foreground">Morning ends · Day ends</p></div>
        <div className="flex items-center gap-2">
          <input type="time" step={1800} value={me || (cap ? hm(cap.morningEnd) : "")} onChange={(e) => setMe(e.target.value)}
            className="h-10 rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground" />
          <input type="time" step={1800} value={de || (cap ? hm(cap.dayEnd) : "")} onChange={(e) => setDe(e.target.value)}
            className="h-10 rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground" />
          <button disabled={(!me && !de) || setMut.isPending} className={primaryBtn}
            onClick={async () => {
              const m = me ? toMin(me) : cap!.morningEnd, dd = de ? toMin(de) : cap!.dayEnd;
              if (m >= dd) { toast.error("Morning must end before Day"); return; }
              if (me) await setMut.mutateAsync({ key: `${group}_band_morning_end` as CapKey, value: String(m) });
              if (de) await setMut.mutateAsync({ key: `${group}_band_day_end` as CapKey, value: String(dd) });
              setMe(""); setDe("");
            }}>Save</button>
        </div>
      </div>
    </section>
  );
}
