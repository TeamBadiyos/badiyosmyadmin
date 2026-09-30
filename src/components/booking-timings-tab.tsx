import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  getBookingTimingSettings,
  saveBookingTimingSettings,
  type BookingTimingKey,
} from "@/lib/booking-settings.functions";

type FieldDef = {
  key: BookingTimingKey;
  label: string;
  help: string;
  unit: string;
  min: number;
  max: number;
};

const GROUPS: Array<{ title: string; blurb: string; fields: FieldDef[] }> = [
  {
    title: "Dispatch & slots",
    blurb: "When the expert search starts and which hours customers can book.",
    fields: [
      {
        key: "booking_dispatch_lead_minutes",
        label: "Dispatch lead",
        help: "Start looking for an expert this many minutes before the slot.",
        unit: "minutes",
        min: 0,
        max: 720,
      },
      {
        key: "booking_buffer_minutes",
        label: "Buffer between jobs",
        help: "Spare time kept around each booking so an expert is not double-booked.",
        unit: "minutes",
        min: 0,
        max: 120,
      },
      {
        key: "slot_first_start_hour",
        label: "First slot starts at",
        help: "Earliest hour of the day a customer can pick (24-hour clock, IST).",
        unit: "o'clock",
        min: 0,
        max: 23,
      },
      {
        key: "slot_last_start_hour",
        label: "Last slot starts at",
        help: "Latest hour of the day a customer can pick (24-hour clock, IST).",
        unit: "o'clock",
        min: 0,
        max: 23,
      },
    ],
  },
  {
    title: "On the way deadlines",
    blurb: "How long an assigned expert has before we flag the job as running late.",
    fields: [
      {
        key: "asap_onway_deadline_minutes",
        label: "ASAP — on the way within",
        help: "For instant bookings, alert if the expert has not started out in this time.",
        unit: "minutes",
        min: 1,
        max: 120,
      },
      {
        key: "scheduled_onway_deadline_before_slot_minutes",
        label: "Scheduled — on the way before slot",
        help: "For booked slots, alert if the expert is not on the way this long before the slot.",
        unit: "minutes",
        min: 0,
        max: 240,
      },
      {
        key: "expert_reminder_before_slot_minutes",
        label: "Remind the expert",
        help: "Send the assigned expert a reminder this many minutes before the slot.",
        unit: "minutes",
        min: 0,
        max: 240,
      },
    ],
  },
  {
    title: "No expert found",
    blurb: "What happens when nobody accepts the booking in time.",
    fields: [
      {
        key: "no_expert_alert_before_slot_minutes",
        label: "Warn before slot",
        help: "Warn the customer and the team if no expert is found this long before the slot.",
        unit: "minutes",
        min: 0,
        max: 240,
      },
      {
        key: "no_expert_refund_after_slot_minutes",
        label: "Cancel & refund after slot",
        help: "Cancel with a full refund if still no expert this long after the slot time.",
        unit: "minutes",
        min: 0,
        max: 240,
      },
    ],
  },
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);

export function BookingTimingsTab() {
  const queryClient = useQueryClient();
  const fetchSettings = useServerFn(getBookingTimingSettings);
  const saveSettings = useServerFn(saveBookingTimingSettings);

  const settingsQuery = useQuery({
    queryKey: ["booking-timings"],
    queryFn: () => fetchSettings(),
    retry: false,
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const saved = settingsQuery.data?.values;

  useEffect(() => {
    if (saved) setDraft({ ...saved });
  }, [saved]);

  const canEdit = Boolean(settingsQuery.data?.canEdit);
  const dirty = useMemo(() => {
    if (!saved) return false;
    return Object.keys(saved).some((k) => (draft[k] ?? "") !== saved[k as BookingTimingKey]);
  }, [draft, saved]);

  const saveMut = useMutation({
    mutationFn: (values: Record<string, string>) =>
      saveSettings({ data: { values: values as Record<BookingTimingKey, string> } }),
    onSuccess: () => {
      toast.success("Booking timings saved");
      queryClient.invalidateQueries({ queryKey: ["booking-timings"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", "journey-config"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  if (settingsQuery.isLoading) {
    return <p className="text-[13px] text-muted-foreground">Loading booking timings…</p>;
  }
  if (settingsQuery.isError || !saved) {
    return (
      <p className="text-[13px] text-muted-foreground">
        You do not have access to booking timing settings.
      </p>
    );
  }

  const journeyOn = (draft["expert_journey_steps_enabled"] ?? "0") === "1";

  return (
    <div className="space-y-4">
      {!canEdit ? (
        <div className="rounded-[12px] border border-border bg-muted px-4 py-2 text-[12px] text-muted-foreground">
          Read-only — only a super admin can change booking timings.
        </div>
      ) : null}

      {GROUPS.map((group) => (
        <section key={group.title} className="rounded-[16px] border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Clock size={16} className="shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-foreground">{group.title}</h3>
              <p className="text-[12px] text-muted-foreground">{group.blurb}</p>
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {group.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="block text-[13px] font-semibold text-foreground">
                  {field.label}
                </span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {field.help}
                </span>
                <span className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={field.min}
                    max={field.max}
                    disabled={!canEdit}
                    value={draft[field.key] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [field.key]: e.target.value }))
                    }
                    className="h-10 w-28 rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground disabled:opacity-60"
                  />
                  <span className="text-[12px] text-muted-foreground">{field.unit}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-[16px] border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
          <div className="min-w-0 max-w-xl">
            <h3 className="text-[15px] font-bold text-foreground">
              On the way / Arrived steps
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Requires experts to mark &quot;On the way&quot; and &quot;Arrived&quot; before
              starting a job.
            </p>
            <p className="mt-2 flex items-start gap-1.5 rounded-[10px] border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] font-semibold text-foreground">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
              Turn ON only after the new Expert App build is installed by all Experts.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={journeyOn}
            aria-label="Enforce on the way and arrived steps"
            disabled={!canEdit}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                expert_journey_steps_enabled: journeyOn ? "0" : "1",
              }))
            }
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              journeyOn ? "bg-primary" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
                journeyOn ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!dirty || saveMut.isPending}
            onClick={() => {
              const values: Record<string, string> = {
                expert_journey_steps_enabled: draft["expert_journey_steps_enabled"] ?? "0",
              };
              for (const f of ALL_FIELDS) values[f.key] = draft[f.key] ?? "";
              saveMut.mutate(values);
            }}
            className="h-10 rounded-[10px] bg-primary px-5 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {saveMut.isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            disabled={!dirty || saveMut.isPending}
            onClick={() => setDraft({ ...saved })}
            className="h-10 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      ) : null}
    </div>
  );
}
