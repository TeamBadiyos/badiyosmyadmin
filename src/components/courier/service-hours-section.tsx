import { DateInput } from "@/components/date-input";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarOff, ChevronDown, Eye, PowerOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  addServiceHoliday,
  closeServiceToday,
  editServiceHoliday,
  getServicePreview,
  reopenServiceToday,
  removeServiceHoliday,
  saveServiceHours,
  setServiceHoursEnabled,
  type ServiceFlagControl,
  type ServiceHolidayRow,
  type ServiceHourRow,
} from "@/lib/service-control.functions";
import {
  StatusPill,
  controlInputCls,
  fmtIst,
  isoToIstInput,
  istInputToIso,
  todayIst,
} from "./service-status-section";

const WEEKDAYS = [
  { n: 1, label: "Monday" },
  { n: 2, label: "Tuesday" },
  { n: 3, label: "Wednesday" },
  { n: 4, label: "Thursday" },
  { n: 5, label: "Friday" },
  { n: 6, label: "Saturday" },
  { n: 0, label: "Sunday" },
];

type HourDraft = { weekday: number; openTime: string; closeTime: string; isClosed: boolean };

function toDraft(hours: ServiceHourRow[], flagId: string): HourDraft[] {
  return WEEKDAYS.map((d) => {
    const row = hours.find((h) => h.service_flag_id === flagId && h.weekday === d.n);
    return {
      weekday: d.n,
      openTime: (row?.open_time ?? "09:00").slice(0, 5),
      closeTime: (row?.close_time ?? "21:00").slice(0, 5),
      isClosed: row?.is_closed ?? false,
    };
  });
}

function cutoffLabel(flag: ServiceFlagControl): string {
  const min = flag.last_order_buffer_minutes ?? 0;
  const base = flag.service_key === "courier" ? "Last order time" : "Last slot ends";
  return `${base}: ${min} min before closing`;
}

export function ServiceHoursEditor({
  flag,
  hours,
  holidays,
  canWrite,
  onSaved,
  afterHours,
}: {
  afterHours?: ReactNode;
  flag: ServiceFlagControl;
  hours: ServiceHourRow[];
  holidays: ServiceHolidayRow[];
  canWrite: boolean;
  onSaved: () => void;
}) {
  const saveHours = useServerFn(saveServiceHours);
  const toggleEnabled = useServerFn(setServiceHoursEnabled);
  const addHol = useServerFn(addServiceHoliday);
  const editHol = useServerFn(editServiceHoliday);
  const delHol = useServerFn(removeServiceHoliday);
  const closeToday = useServerFn(closeServiceToday);
  const reopenToday = useServerFn(reopenServiceToday);

  const [rows, setRows] = useState<HourDraft[]>(() => toDraft(hours, flag.id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<ServiceHolidayRow | null>(null);
  const [holStart, setHolStart] = useState("");
  const [holEnd, setHolEnd] = useState("");
  const [holReason, setHolReason] = useState("");
  const [holReasonMr, setHolReasonMr] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [closeReasonMr, setCloseReasonMr] = useState("");
  const [closeUntil, setCloseUntil] = useState("");

  const today = todayIst();
  const closedToday =
    flag.closed_today_date === today ||
    (flag.closed_until ? new Date(flag.closed_until).getTime() > Date.now() : false);

  const myHolidays = useMemo(
    () =>
      holidays.filter((h) => {
        if (h.service_flag_id && h.service_flag_id !== flag.id) return false;
        const end = h.end_date ?? h.start_date;
        return end >= today; // beet chuki holidays display se hatao
      }),
    [holidays, flag.id, today],
  );

  const dirty = JSON.stringify(rows) !== JSON.stringify(toDraft(hours, flag.id));

  function validate(): boolean {
    for (const r of rows) {
      if (!r.isClosed && r.closeTime <= r.openTime) {
        setError(`Closing time must be after opening time (${WEEKDAYS.find((d) => d.n === r.weekday)?.label})`);
        return false;
      }
    }
    setError(null);
    return true;
  }

  async function onSaveHours() {
    if (!validate()) return;
    setBusy(true);
    try {
      await saveHours({
        data: { serviceKey: flag.service_key, rows, knownUpdatedAt: flag.updated_at },
      });
      toast.success("Hours saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleEnabled(next: boolean) {
    setBusy(true);
    try {
      await toggleEnabled({ data: { serviceKey: flag.service_key, enabled: next } });
      toast.success(next ? "Opening hours on" : "Opening hours off — the service now follows its status only");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveHoliday() {
    if (!holStart) {
      toast.error("Pick a start date");
      return;
    }
    if (holEnd && holEnd < holStart) {
      toast.error("End date cannot be before the start date");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        serviceKey: flag.service_key,
        startDate: holStart,
        endDate: holEnd || null,
        reason: holReason.trim() || undefined,
        reasonMr: holReasonMr.trim() || undefined,
      };
      if (editingHoliday) {
        await editHol({ data: { ...payload, holidayId: editingHoliday.id } });
        toast.success("Holiday updated");
      } else {
        await addHol({ data: payload });
        toast.success("Holiday added");
      }
      setShowHolidayForm(false);
      setEditingHoliday(null);
      setHolStart("");
      setHolEnd("");
      setHolReason("");
      setHolReasonMr("");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCloseToday() {
    setBusy(true);
    try {
      const reason = [closeReason.trim(), closeReasonMr.trim()].filter(Boolean).join(" / ");
      await closeToday({
        data: {
          serviceKey: flag.service_key,
          reason: reason || undefined,
          until: istInputToIso(closeUntil),
        },
      });
      toast.success("Closed for today — reopens automatically at midnight IST");
      setShowCloseForm(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onReopen() {
    setBusy(true);
    try {
      await reopenToday({ data: { serviceKey: flag.service_key } });
      toast.success("Service reopened");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const openRows = rows.filter((r) => !r.isClosed);
  const everyFrom = openRows[0]?.openTime ?? "09:00";
  const everyTo = openRows[0]?.closeTime ?? "19:00";
  const mixed = openRows.some((r) => r.openTime !== everyFrom || r.closeTime !== everyTo);
  const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-4">
      {/* weekly hours */}
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <input type="checkbox" checked={flag.hours_enabled} disabled={!canWrite || busy}
            onChange={(e) => void onToggleEnabled(e.target.checked)} />
          Use opening hours
          <span className="text-[11px]">· When off, the service follows its status only.</span>
        </label>

        <div>
          <p className="text-[13px] font-semibold text-foreground">Open every day</p>
          <p className="text-[12px] text-muted-foreground">One time used for all open days. The first slot starts at opening time.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">from</span>
            <input type="time" value={everyFrom} disabled={!canWrite}
              onChange={(e) => setRows(rows.map((x) => (x.isClosed ? x : { ...x, openTime: e.target.value })))}
              className={controlInputCls + " w-auto"} />
            <span className="text-muted-foreground">to</span>
            <input type="time" value={everyTo} disabled={!canWrite}
              onChange={(e) => setRows(rows.map((x) => (x.isClosed ? x : { ...x, closeTime: e.target.value })))}
              className={controlInputCls + " w-auto"} />
            {mixed ? <span className="text-[12px] text-warning">Some days have a different time (see below)</span> : null}
          </div>
        </div>

        <div>
          <p className="text-[13px] font-semibold text-foreground">Weekly off</p>
          <p className="text-[12px] text-muted-foreground">Tap the days the service is closed every week.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rows.map((r, i) => (
              <button key={r.weekday} type="button" disabled={!canWrite}
                onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, isClosed: !x.isClosed, openTime: everyFrom, closeTime: everyTo } : x)))}
                className={`h-9 min-w-[52px] rounded-full px-3 text-[12px] font-semibold disabled:opacity-50 ${r.isClosed ? "bg-destructive/10 text-destructive border border-destructive/40" : "border border-border text-foreground"}`}>
                {SHORT[r.weekday]}
              </button>
            ))}
          </div>
        </div>

        <details className="rounded-[12px] border border-border" open={mixed || undefined}>
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] font-semibold text-foreground">
            <ChevronDown size={14} /> Different time on some days
            <span className="text-[12px] font-normal text-muted-foreground">· Only needed if a day has its own hours.</span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Open (IST)</th>
                <th className="px-3 py-2">Close (IST)</th>
                <th className="px-3 py-2">Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.weekday} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-semibold text-foreground">{WEEKDAYS.find((d) => d.n === r.weekday)?.label}</td>
                  <td className="px-3 py-2">
                    <input type="time" value={r.openTime} disabled={!canWrite || r.isClosed}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, openTime: e.target.value } : x)))}
                      className={controlInputCls + " w-auto"} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="time" value={r.closeTime} disabled={!canWrite || r.isClosed}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, closeTime: e.target.value } : x)))}
                      className={controlInputCls + " w-auto"} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={r.isClosed} disabled={!canWrite}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, isClosed: e.target.checked } : x)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </details>
        {error ? <p className="mt-1 text-[12px] font-semibold text-destructive">{error}</p> : null}
        {canWrite ? (
          <div className="flex justify-end">
            <button onClick={() => void onSaveHours()} disabled={busy || !dirty}
              className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50">
              Save hours
            </button>
          </div>
        ) : null}
      </div>

      {afterHours}

      {/* closed today banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border bg-muted/40 px-4 py-3">
        <div className="text-[12px] text-foreground">
          {closedToday ? (
            <>
              <strong className="text-destructive">Closed today</strong>
              {flag.closed_today_reason ? ` — ${flag.closed_today_reason}` : ""}
              {flag.closed_until ? ` · until ${fmtIst(flag.closed_until)}` : " · until midnight IST"}
            </>
          ) : (
            "Close today: stop new bookings for the rest of today."
          )}
        </div>
        {closedToday ? (
          <button
            onClick={() => void onReopen()}
            disabled={!canWrite || busy}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground disabled:opacity-50"
          >
            <RotateCcw size={13} /> Reopen
          </button>
        ) : (
          <button
            onClick={() => setShowCloseForm((v) => !v)}
            disabled={!canWrite || busy}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-destructive/40 px-3 py-1.5 text-[12px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <PowerOff size={13} /> Close today
          </button>
        )}
      </div>

      {showCloseForm && !closedToday ? (
        <div className="grid gap-3 rounded-[12px] border border-border p-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Reason (English)</span>
            <input
              value={closeReason}
              disabled={!canWrite}
              onChange={(e) => setCloseReason(e.target.value)}
              className={controlInputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Reason (मराठी)</span>
            <input
              value={closeReasonMr}
              disabled={!canWrite}
              onChange={(e) => setCloseReasonMr(e.target.value)}
              className={controlInputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
              Until (optional, IST) — empty means midnight tonight
            </span>
            <input
              type="datetime-local"
              value={closeUntil}
              disabled={!canWrite}
              onChange={(e) => setCloseUntil(e.target.value)}
              className={controlInputCls}
            />
          </label>
          <div className="flex items-end justify-end">
            <button
              onClick={() => void onCloseToday()}
              disabled={!canWrite || busy}
              className="rounded-[10px] bg-destructive px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Close now
            </button>
          </div>
        </div>
      ) : null}
      </div>

      {/* holidays */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-bold text-foreground">Holidays</span>
          <button
            onClick={() => {
              setEditingHoliday(null);
              setShowHolidayForm((v) => !v);
            }}
            disabled={!canWrite}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <CalendarOff size={13} /> Add holiday
          </button>
        </div>

        {myHolidays.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No upcoming holidays.</p>
        ) : (
          <ul className="space-y-2">
            {myHolidays.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border px-3 py-2"
              >
                <div className="text-[13px]">
                  <span className="font-semibold text-foreground">
                    {h.start_date}
                    {h.end_date && h.end_date !== h.start_date ? ` → ${h.end_date}` : ""}
                  </span>
                  {h.reason ? <span className="ml-2 text-muted-foreground">{h.reason}</span> : null}
                  {h.reason_mr ? <span className="ml-1 text-muted-foreground">/ {h.reason_mr}</span> : null}
                  {!h.service_flag_id ? (
                    <span className="ml-2 rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
                      All services
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingHoliday(h);
                      setHolStart(h.start_date);
                      setHolEnd(h.end_date ?? "");
                      setHolReason(h.reason ?? "");
                      setHolReasonMr(h.reason_mr ?? "");
                      setShowHolidayForm(true);
                    }}
                    disabled={!canWrite}
                    className="rounded-[8px] border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await delHol({ data: { holidayId: h.id } });
                        toast.success("Holiday removed");
                        onSaved();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={!canWrite || busy}
                    className="rounded-[8px] border border-destructive/40 px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {showHolidayForm ? (
          <div className="mt-3 grid gap-3 rounded-[12px] border border-border p-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Start date</span>
              <DateInput
                
                value={holStart}
                disabled={!canWrite}
                onChange={(e) => setHolStart(e.target.value)}
                className={controlInputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
                End date (optional, for a range)
              </span>
              <DateInput
                
                value={holEnd}
                disabled={!canWrite}
                onChange={(e) => setHolEnd(e.target.value)}
                className={controlInputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Reason (English)</span>
              <input
                value={holReason}
                disabled={!canWrite}
                onChange={(e) => setHolReason(e.target.value)}
                className={controlInputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">Reason (मराठी)</span>
              <input
                value={holReasonMr}
                disabled={!canWrite}
                onChange={(e) => setHolReasonMr(e.target.value)}
                className={controlInputCls}
              />
            </label>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button
                onClick={() => {
                  setShowHolidayForm(false);
                  setEditingHoliday(null);
                }}
                className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void onSaveHoliday()}
                disabled={!canWrite || busy}
                className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
              >
                {editingHoliday ? "Update" : "Add"} holiday
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ServicePreviewTable({ canWrite }: { canWrite: boolean }) {
  const preview = useServerFn(getServicePreview);
  const [lang, setLang] = useState<"en" | "mr">("en");
  const [testTime, setTestTime] = useState(() => isoToIstInput(new Date().toISOString()));
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["courier", "service-preview", submittedAt],
    queryFn: () => preview({ data: { at: submittedAt } }),
    enabled: submittedAt !== null,
  });

  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-primary" />
          <h3 className="text-[14px] font-bold text-foreground">Customer ko kya dikhega</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-[10px] border border-border">
            {(["en", "mr"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1.5 text-[12px] font-semibold ${lang === l ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
              >
                {l === "en" ? "English" : "मराठी"}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={testTime}
            onChange={(e) => setTestTime(e.target.value)}
            className={controlInputCls + " w-auto"}
            title="Test time (IST) — staff only"
          />
          <button
            onClick={() => setSubmittedAt(istInputToIso(testTime) ?? new Date().toISOString())}
            className="rounded-[10px] bg-primary px-3 py-2 text-[12px] font-bold text-primary-foreground"
          >
            {isFetching ? "Loading…" : "Preview"}
          </button>
        </div>
      </div>

      {!submittedAt ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Pick a time and press "Preview" — defaults to now (IST).
        </p>
      ) : null}

      {data ? (
        <div className="mt-3 overflow-x-auto rounded-[12px] border border-border">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Open?</th>
                <th className="px-3 py-2">Next open</th>
                <th className="px-3 py-2">Final message</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const st = r.state ?? {};
                const open =
                  typeof st.open === "boolean" ? st.open : typeof st.is_open === "boolean" ? st.is_open : null;
                const msg =
                  (lang === "mr"
                    ? (st.message_mr ?? st.message ?? st.message_en)
                    : (st.message_en ?? st.message ?? st.message_mr)) ?? "—";
                const nextOpen = (st.next_open_at ?? st.next_open ?? null) as string | null;
                const status = (st.status ?? r.serviceKey) as string;
                return (
                  <tr key={r.serviceKey + r.city} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-semibold text-foreground">{r.label}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={status} />
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-[11px] text-destructive">{r.error}</span>
                      ) : open === null ? (
                        "—"
                      ) : open ? (
                        <span className="font-semibold text-primary">Open</span>
                      ) : (
                        <span className="font-semibold text-warning">Band</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{nextOpen ? fmtIst(nextOpen) : "—"}</td>
                    <td className="max-w-[280px] px-3 py-2 text-muted-foreground">{String(msg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {!canWrite ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Read-only — you can view but not change these.
        </p>
      ) : null}
    </div>
  );
}

export function ServiceHoursSection({
  flags,
  hours,
  holidays,
  canWrite,
  onSaved,
}: {
  flags: ServiceFlagControl[];
  hours: ServiceHourRow[];
  holidays: ServiceHolidayRow[];
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <h3 className="text-[14px] font-bold text-foreground">Service Hours</h3>
      {flags.map((f) => (
        <div key={f.id} className="rounded-[16px] border border-border bg-card p-4">
          <button
            onClick={() => setOpenKey(openKey === f.service_key ? null : f.service_key)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-foreground">{f.label ?? f.service_key}</span>
              <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
                {f.city}
              </span>
              {f.hours_enabled ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  Hours on
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  Hours off
                </span>
              )}
            </div>
            <ChevronDown
              size={16}
              className={`text-muted-foreground transition-transform ${openKey === f.service_key ? "rotate-180" : ""}`}
            />
          </button>
          {openKey === f.service_key ? (
            <ServiceHoursEditor
              flag={f}
              hours={hours}
              holidays={holidays}
              canWrite={canWrite}
              onSaved={onSaved}
            />
          ) : null}
        </div>
      ))}
      <ServicePreviewTable canWrite={canWrite} />
    </div>
  );
}
