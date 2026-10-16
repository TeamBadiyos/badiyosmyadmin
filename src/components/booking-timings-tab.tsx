import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useCity } from "@/lib/city-scope";
import {
  getBookingTimingSettings,
  saveBookingTimingSettings,
  type BookingTimingKey,
} from "@/lib/booking-settings.functions";
import { NowAndAutoCancelRows } from "@/components/slot-availability-tab";
import { CancelFeeRows } from "@/components/cancel-rules";
import type { CapGroup } from "@/lib/booking-settings.functions";

type NumField = { key: BookingTimingKey; label: string; help: string; unit: string; min: number; max: number };
type SwitchField = { key: BookingTimingKey; label: string; help: string; def: "0" | "1" };

const BOOKING_NUM: NumField[] = [
  { key: "slot_step_minutes", label: "Slot gap", help: "30 gives half-hourly slots, 60 gives hourly slots.", unit: "minutes", min: 30, max: 60 },
  { key: "booking_dispatch_lead_minutes", label: "Dispatch lead", help: "Start looking for an expert this long before the slot.", unit: "minutes", min: 0, max: 720 },
  { key: "booking_buffer_minutes", label: "Buffer between jobs", help: "Spare time kept after each job so an expert is not double-booked.", unit: "minutes", min: 0, max: 120 },
];
const BOOKING_SW: SwitchField[] = [
  { key: "service_extensions_enabled", label: "Service extension", help: "Lets customers add extra time while a service is running.", def: "1" },
];
const EXPERT_SW: SwitchField[] = [
  { key: "expert_journey_steps_enabled", label: "On the way / Arrived steps", help: "Experts must tap On the way and Arrived before starting a job.", def: "0" },
];
const EXPERT_NUM: NumField[] = [
  { key: "asap_onway_deadline_minutes", label: "ASAP: on the way within", help: "For 'Now' bookings, flag the job if the expert has not left in this time.", unit: "minutes", min: 1, max: 120 },
  { key: "scheduled_onway_deadline_before_slot_minutes", label: "Scheduled: on the way before slot", help: "Flag the job if the expert is not on the way this long before the slot.", unit: "minutes", min: 0, max: 240 },
  { key: "expert_reminder_before_slot_minutes", label: "Remind expert", help: "Send the expert a reminder this long before the slot.", unit: "minutes", min: 0, max: 240 },
  { key: "no_expert_alert_before_slot_minutes", label: "Warn before slot", help: "Warn the customer and team if no expert is found this long before the slot.", unit: "minutes", min: 0, max: 240 },
];

const card = "rounded-[16px] border border-border bg-card";

function Switch({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-primary" : "bg-border"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function RulesPanel({ nums, switches, extraTop }: { nums: NumField[]; switches: SwitchField[]; extraTop?: React.ReactNode }) {
  const { city } = useCity();
  const cityId = city?.id ?? null;
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getBookingTimingSettings);
  const saveSettings = useServerFn(saveBookingTimingSettings);
  const q = useQuery({ queryKey: ["booking-timings", cityId], queryFn: () => fetchSettings({ data: { cityId } }), retry: false });
  const saved = q.data?.values;
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { if (saved) setDraft({ ...saved }); }, [saved]);
  const keys = [...nums.map((f) => f.key), ...switches.map((f) => f.key)];
  const dirty = !!saved && keys.some((k) => (draft[k] ?? "") !== (saved[k] ?? ""));
  const canEdit = Boolean(q.data?.canEdit);
  const mut = useMutation({
    mutationFn: () => saveSettings({ data: { values: Object.fromEntries(keys.map((k) => [k, draft[k] ?? ""])) as Record<BookingTimingKey, string>, cityId } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["booking-timings"] }); qc.invalidateQueries({ queryKey: ["pipeline", "journey-config"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <section className={`${card} px-4`}>
      <div className="divide-y divide-border">
        {extraTop}
        {q.isLoading ? <p className="py-4 text-[13px] text-muted-foreground">Loading…</p> : null}
        {q.isError ? <p className="py-4 text-[13px] text-muted-foreground">You do not have access to these settings.</p> : null}
        {saved ? (
          <>
            {nums.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">{f.label}</p><p className="text-[12px] text-muted-foreground">{f.help}</p></div>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" min={f.min} max={f.max} disabled={!canEdit} aria-label={f.label}
                    value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="h-10 w-24 rounded-[10px] border border-border bg-card px-3 text-[14px] text-foreground disabled:opacity-60" />
                  <span className="w-14 text-[12px] text-muted-foreground">{f.unit}</span>
                </div>
              </div>
            ))}
            {switches.map((f) => {
              const on = (draft[f.key] ?? f.def) === "1";
              return (
                <div key={f.key} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0"><p className="text-[14px] font-semibold text-foreground">{f.label}</p><p className="text-[12px] text-muted-foreground">{f.help}</p></div>
                  <Switch label={f.label} on={on} disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d, [f.key]: on ? "0" : "1" }))} />
                </div>
              );
            })}
          </>
        ) : null}
      </div>
      {saved ? (
        <div className="flex items-center justify-end gap-2 border-t border-border py-3">
          {!canEdit ? <span className="mr-auto text-[12px] text-muted-foreground">Read-only — only a super admin can change these.</span> : null}
          <button type="button" disabled={!dirty || mut.isPending} onClick={() => setDraft({ ...saved })}
            className="h-10 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground disabled:opacity-50">Reset</button>
          <button type="button" disabled={!canEdit || !dirty || mut.isPending} onClick={() => mut.mutate()}
            className="h-10 rounded-[10px] bg-primary px-5 text-[13px] font-bold text-primary-foreground disabled:opacity-50">
            {mut.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function BookingRulesPanel({ group }: { group: CapGroup }) {
  return <RulesPanel nums={BOOKING_NUM} switches={BOOKING_SW} extraTop={<><NowAndAutoCancelRows group={group} /><CancelFeeRows group={group} /></>} />;
}

export function ExpertRulesPanel() {
  return <RulesPanel nums={EXPERT_NUM} switches={EXPERT_SW} />;
}
