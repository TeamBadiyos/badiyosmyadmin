import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  applyServiceFocus,
  setServiceStatus,
  undoServiceFocus,
  type FocusSnapshot,
  type ServiceFlagControl,
} from "@/lib/service-control.functions";

/* ------------------------------- shared bits ------------------------------ */

export const STATUS_OPTIONS = [
  { value: "live", label: "Live" },
  { value: "coming_soon", label: "Coming Soon" },
  { value: "temporarily_stopped", label: "Temporarily Stopped" },
  { value: "hidden", label: "Hidden" },
] as const;

export const DEFAULT_STATUS_MESSAGES: Record<string, { en: string; mr: string }> = {
  coming_soon: {
    en: "This service is launching soon.",
    mr: "ही सेवा लवकरच सुरू होत आहे.",
  },
  temporarily_stopped: {
    en: "This service is temporarily paused. Please check back later.",
    mr: "ही सेवा तात्पुरती थांबवली आहे. कृपया थोड्या वेळाने तपासा.",
  },
  hidden: { en: "", mr: "" },
  live: { en: "", mr: "" },
};

export function statusLabel(s: string): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

const IST = "Asia/Kolkata";

export function fmtIst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleString("en-IN", {
      timeZone: IST,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) + " IST"
  );
}

/** datetime-local input value interpreted as IST → ISO. */
export function istInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v.length === 16 ? v + ":00+05:30" : v + "+05:30");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → datetime-local value as seen in IST. */
export function isoToIstInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

export function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const controlInputCls =
  "w-full rounded-[10px] border border-border bg-background px-3 py-2 text-[13px] text-foreground disabled:opacity-50";

export function StatusPill({ status }: { status: string }) {
  const cls =
    status === "live"
      ? "bg-primary/10 text-primary"
      : status === "coming_soon"
        ? "bg-info/10 text-info"
        : status === "temporarily_stopped"
          ? "bg-warning/15 text-warning"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {statusLabel(status)}
    </span>
  );
}

function MiniModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-secondary/40 p-4 sm:p-8">
      <div className="modal-pop w-full max-w-xl rounded-[18px] border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-[16px] font-bold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-[10px] px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ status section ---------------------------- */

function StatusRow({
  flag,
  canWrite,
  activeOrders,
  onSaved,
}: {
  flag: ServiceFlagControl;
  canWrite: boolean;
  activeOrders: number;
  onSaved: () => void;
}) {
  const save = useServerFn(setServiceStatus);
  const [status, setStatus] = useState(flag.status || "live");
  const [noteEn, setNoteEn] = useState(flag.status_message_en ?? "");
  const [noteMr, setNoteMr] = useState(flag.status_message_mr ?? "");
  const [resumeAt, setResumeAt] = useState(isoToIstInput(flag.resume_at));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const dirty =
    status !== (flag.status || "live") ||
    noteEn !== (flag.status_message_en ?? "") ||
    noteMr !== (flag.status_message_mr ?? "") ||
    resumeAt !== isoToIstInput(flag.resume_at);

  const defaults = DEFAULT_STATUS_MESSAGES[status] ?? { en: "", mr: "" };

  async function apply() {
    setBusy(true);
    try {
      await save({
        data: {
          serviceKey: flag.service_key,
          status,
          messageEn: noteEn.trim() || null,
          messageMr: noteMr.trim() || null,
          resumeAt: istInputToIso(resumeAt),
          knownUpdatedAt: flag.status_updated_at ?? flag.updated_at,
        },
      });
      toast.success(`${flag.label ?? flag.service_key} status saved`);
      setConfirming(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function onSaveClick() {
    if (status !== (flag.status || "live") && status !== "live") {
      setConfirming(true);
    } else {
      void apply();
    }
  }

  return (
    <div className="rounded-[16px] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-foreground">{flag.label ?? flag.service_key}</span>
            <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-semibold text-info">
              {flag.city}
            </span>
            <StatusPill status={flag.status || "live"} />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {activeOrders} active order{activeOrders === 1 ? "" : "s"} right now
            {flag.resume_at ? ` · resumes ${fmtIst(flag.resume_at)}` : ""}
          </p>
        </div>
        <select
          value={status}
          disabled={!canWrite || busy}
          onChange={(e) => setStatus(e.target.value)}
          className={controlInputCls + " w-auto"}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {status !== "hidden" && status !== "live" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
              Note (English) — khaali chhoda to default jayega
            </span>
            <input
              value={noteEn}
              disabled={!canWrite}
              onChange={(e) => setNoteEn(e.target.value)}
              placeholder={defaults.en}
              className={controlInputCls}
            />
            {defaults.en ? (
              <span className="mt-1 block text-[11px] text-muted-foreground">Default: {defaults.en}</span>
            ) : null}
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
              Note (मराठी)
            </span>
            <input
              value={noteMr}
              disabled={!canWrite}
              onChange={(e) => setNoteMr(e.target.value)}
              placeholder={defaults.mr}
              className={controlInputCls}
            />
            {defaults.mr ? (
              <span className="mt-1 block text-[11px] text-muted-foreground">Default: {defaults.mr}</span>
            ) : null}
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
              Wapas kab shuru hoga (optional, IST)
            </span>
            <input
              type="datetime-local"
              value={resumeAt}
              disabled={!canWrite}
              onChange={(e) => setResumeAt(e.target.value)}
              className={controlInputCls + " sm:max-w-xs"}
            />
          </label>
        </div>
      ) : null}

      {canWrite && dirty ? (
        <div className="mt-3 flex justify-end">
          <button
            onClick={onSaveClick}
            disabled={busy}
            className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Save status
          </button>
        </div>
      ) : null}

      {confirming ? (
        <MiniModal title="Status badalna hai?" onClose={() => setConfirming(false)}>
          <div className="rounded-[12px] border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-center gap-2 text-[13px] font-bold text-foreground">
              <AlertTriangle size={15} className="text-warning" />
              {flag.label ?? flag.service_key} → {statusLabel(status)}
            </div>
            <p className="mt-2 text-[13px] text-foreground">
              Is service par abhi <strong>{activeOrders}</strong> active order
              {activeOrders === 1 ? "" : "s"} hain. Naye orders ruk jayenge; chal rahe orders
              continue rahenge — kuch delete nahi hoga.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => void apply()}
              disabled={busy}
              className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </MiniModal>
      ) : null}
    </div>
  );
}

export function ServiceStatusSection({
  flags,
  canWrite,
  activeOrdersByKey,
  undo,
  onSaved,
}: {
  flags: ServiceFlagControl[];
  canWrite: boolean;
  activeOrdersByKey: Map<string, number>;
  undo: FocusSnapshot | null;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const focus = useServerFn(applyServiceFocus);
  const undoFn = useServerFn(undoServiceFocus);
  const [presetOpen, setPresetOpen] = useState(false);
  const [liveKey, setLiveKey] = useState(flags[0]?.service_key ?? "");
  const [noteEn, setNoteEn] = useState("");
  const [noteMr, setNoteMr] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoState, setUndoState] = useState<FocusSnapshot | null>(undo);

  const undoExpired = undoState ? new Date(undoState.expires_at).getTime() < Date.now() : true;
  const undoMinutesLeft = useMemo(() => {
    if (!undoState) return 0;
    return Math.max(0, Math.round((new Date(undoState.expires_at).getTime() - Date.now()) / 60000));
  }, [undoState]);

  const others = flags.filter((f) => f.service_key !== liveKey);
  const liveFlag = flags.find((f) => f.service_key === liveKey);

  async function applyPreset() {
    setBusy(true);
    try {
      const res = await focus({
        data: {
          liveServiceKey: liveKey,
          othersStatus: "coming_soon",
          messageEn: noteEn.trim() || undefined,
          messageMr: noteMr.trim() || undefined,
        },
      });
      toast.success("Preset applied");
      if (res.undoToken && res.expiresAt) {
        setUndoState({ undo_token: res.undoToken, expires_at: res.expiresAt, created_at: new Date().toISOString() });
      }
      setPresetOpen(false);
      setNoteEn("");
      setNoteMr("");
      qc.invalidateQueries({ queryKey: ["courier", "service-control"] });
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preset failed");
    } finally {
      setBusy(false);
    }
  }

  async function doUndo() {
    if (!undoState) return;
    setBusy(true);
    try {
      await undoFn({ data: { undoToken: undoState.undo_token } });
      toast.success("Purani halat wapas aa gayi");
      setUndoState(null);
      qc.invalidateQueries({ queryKey: ["courier", "service-control"] });
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Undo failed";
      toast.error(
        /expired|used|state|changed|mismatch/i.test(msg)
          ? "Beech me kisi ne status badal diya hai, isliye purani halat wapas nahi ho sakti."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-foreground">Service Status</h3>
        <button
          onClick={() => setPresetOpen(true)}
          disabled={!canWrite || busy}
          className="rounded-[10px] border border-border px-3 py-2 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          Sirf ek live, baaki Coming Soon
        </button>
      </div>

      {undoState && !undoExpired ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-info/40 bg-info/10 px-4 py-3">
          <p className="text-[12px] text-foreground">
            Preset abhi apply hua tha — <strong>{undoMinutesLeft} min</strong> ke andar Undo kar sakte hain.
          </p>
          <button
            onClick={() => void doUndo()}
            disabled={!canWrite || busy}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Undo2 size={13} /> Undo
          </button>
        </div>
      ) : null}

      {flags.map((f) => (
        <StatusRow
          key={`${f.id}:${f.status_updated_at ?? f.updated_at ?? ""}`}
          flag={f}
          canWrite={canWrite}
          activeOrders={activeOrdersByKey.get(f.service_key) ?? 0}
          onSaved={onSaved}
        />
      ))}

      {presetOpen ? (
        <MiniModal title="Sirf ek live, baaki Coming Soon" onClose={() => setPresetOpen(false)}>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
              Kaunsi service live rahegi?
            </span>
            <select value={liveKey} onChange={(e) => setLiveKey(e.target.value)} className={controlInputCls}>
              {flags.map((f) => (
                <option key={f.service_key} value={f.service_key}>
                  {f.label ?? f.service_key} ({f.city})
                </option>
              ))}
            </select>
          </label>

          {liveFlag ? (
            <p className="mt-3 rounded-[12px] bg-primary/10 px-4 py-3 text-[15px] font-bold uppercase tracking-wide text-primary">
              {liveFlag.label ?? liveFlag.service_key} — LIVE rahega
            </p>
          ) : null}

          <div className="mt-3 rounded-[12px] border border-border p-3">
            <p className="text-[12px] font-semibold text-muted-foreground">Ye services Coming Soon ho jayengi:</p>
            <ul className="mt-2 space-y-1">
              {others.map((f) => (
                <li key={f.id} className="flex items-center justify-between text-[13px]">
                  <span className="font-bold uppercase text-foreground">{f.label ?? f.service_key}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {activeOrdersByKey.get(f.service_key) ?? 0} active orders
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Naye orders ruk jayenge; chal rahe orders continue rahenge — kuch delete nahi hoga.
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
                Common note (English, optional)
              </span>
              <input
                value={noteEn}
                onChange={(e) => setNoteEn(e.target.value)}
                placeholder={DEFAULT_STATUS_MESSAGES.coming_soon.en}
                className={controlInputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-muted-foreground">
                Common note (मराठी, optional)
              </span>
              <input
                value={noteMr}
                onChange={(e) => setNoteMr(e.target.value)}
                placeholder={DEFAULT_STATUS_MESSAGES.coming_soon.mr}
                className={controlInputCls}
              />
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setPresetOpen(false)}
              className="rounded-[10px] border border-border px-4 py-2 text-[13px] font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => void applyPreset()}
              disabled={busy || !liveKey}
              className="rounded-[10px] bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Apply preset
            </button>
          </div>
        </MiniModal>
      ) : null}
    </div>
  );
}
