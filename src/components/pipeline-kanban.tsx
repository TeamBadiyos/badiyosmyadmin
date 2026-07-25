import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X, UserPlus, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  acceptPendingBooking,
  assignExpertToBooking,
  countEligibleExperts,
  getDispatchConfig,
  listActiveExperts,
  listPipelineBookings,
  rejectPendingBooking,
  REJECT_REASONS,
  type PipelineBooking,
  type PipelineStatus,
  type RejectReason,
} from "@/lib/live-orders.functions";
import { BookingDetailsModal } from "@/components/booking-details-modal";
import type { StaffRole } from "@/lib/staff.functions";

const COLUMNS: Array<{ key: PipelineStatus; label: string }> = [
  { key: "confirmed", label: "Confirmed" },
  { key: "accepted", label: "Needs Expert" },
  { key: "expert_assigned", label: "Expert Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed Today" },
];

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type AudioHandle = {
  ctx: AudioContext;
  osc: OscillatorNode;
  gain: GainNode;
  interval: number;
};

function startBeep(ref: React.MutableRefObject<AudioHandle | null>) {
  if (ref.current) return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const beep = () => {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.25);
    };
    beep();
    const interval = window.setInterval(beep, 1500);
    ref.current = { ctx, osc, gain, interval };
  } catch {
    /* audio unsupported */
  }
}

function stopBeep(ref: React.MutableRefObject<AudioHandle | null>) {
  const h = ref.current;
  if (!h) return;
  window.clearInterval(h.interval);
  try {
    h.osc.stop();
  } catch {
    /* noop */
  }
  h.ctx.close().catch(() => {});
  ref.current = null;
}

export function PipelineKanban({ role }: { role: StaffRole | null }) {
  const queryClient = useQueryClient();
  const fetchPipeline = useServerFn(listPipelineBookings);
  const fetchDispatchConfig = useServerFn(getDispatchConfig);

  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["pipeline", "board"],
    queryFn: () => fetchPipeline(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  const dispatchConfigQuery = useQuery({
    queryKey: ["dispatch-config"],
    queryFn: () => fetchDispatchConfig(),
    staleTime: 5 * 60_000,
  });
  const broadcastTimeoutSeconds =
    dispatchConfigQuery.data?.broadcastTimeoutSeconds ?? 90;

  // Realtime subscription: any booking status change refreshes the board.
  useEffect(() => {
    const channel = supabase
      .channel("pipeline-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const grouped = useMemo(() => {
    const map = new Map<PipelineStatus, PipelineBooking[]>();
    COLUMNS.forEach((c) => map.set(c.key, []));
    for (const b of data ?? []) {
      const bucket = map.get(b.status);
      if (bucket) bucket.push(b);
    }
    return map;
  }, [data]);

  // Audio alerts for new "Confirmed" (unactioned) bookings.
  const confirmedIds = useMemo(
    () => (grouped.get("confirmed") ?? []).map((b) => b.id),
    [grouped],
  );
  const audioRef = useRef<AudioHandle | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [showEnablePrompt, setShowEnablePrompt] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("pipeline-audio-prompt-dismissed") !== "1";
  });
  function dismissEnablePrompt() {
    sessionStorage.setItem("pipeline-audio-prompt-dismissed", "1");
    setShowEnablePrompt(false);
  }

  useEffect(() => {
    if (!audioEnabled) {
      stopBeep(audioRef);
      return;
    }
    if (confirmedIds.length === 0) {
      stopBeep(audioRef);
      return;
    }
    startBeep(audioRef);
  }, [audioEnabled, confirmedIds.length]);

  useEffect(() => {
    return () => stopBeep(audioRef);
  }, []);

  return (
    <section className="bg-card border border-border rounded-[18px] p-4 sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-foreground">
            Booking Pipeline
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Live board — cards move as statuses change.
          </p>
          {isError && (
            <p className="text-[12px] text-destructive mt-1">
              Failed to load board
              {error instanceof Error && error.message ? `: ${error.message}` : ""}.
            </p>
          )}
        </div>
        <button
          onClick={() => setAudioEnabled((v) => !v)}
          className={`shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            audioEnabled
              ? "border-primary text-primary bg-primary-tint"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={audioEnabled}
          title="Toggle order alert sound"
        >
          {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          {audioEnabled ? "Sound on" : "Sound off"}
        </button>
      </div>

      {showEnablePrompt && !audioEnabled && (
        <div className="mb-4 flex items-start gap-3 p-3 rounded-[14px] bg-primary-tint border border-primary/30">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              Enable order alerts?
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Play a sound while new bookings wait in “Confirmed”.
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                setAudioEnabled(true);
                dismissEnablePrompt();
              }}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:opacity-90"
            >
              Enable
            </button>
            <button
              onClick={dismissEnablePrompt}
              aria-label="Dismiss"
              className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 grid-cols-[repeat(5,minmax(220px,1fr))] overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.key) ?? [];
          return (
            <div
              key={col.key}
              className="min-w-0 bg-background border border-border rounded-[14px] flex flex-col"
            >
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-[12px] font-bold uppercase tracking-wide text-foreground truncate">
                  {col.label}
                </span>
                <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full bg-primary-tint text-primary text-[11px] font-bold shrink-0">
                  {items.length}
                </span>
              </div>
              <div className="p-3 space-y-3 max-h-[600px] overflow-y-auto">
                {isLoading && items.length === 0 && (
                  <p className="text-[12px] text-muted-foreground px-1">
                    Loading…
                  </p>
                )}
                {!isLoading && items.length === 0 && (
                  <p className="text-[12px] text-muted-foreground px-1">
                    No bookings.
                  </p>
                )}
                {items.map((b) => (
                  <BoardCard
                    key={b.id}
                    booking={b}
                    role={role}
                    broadcastTimeoutSeconds={broadcastTimeoutSeconds}
                    onOpen={() => setOpenId(b.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {openId && (
        <BookingDetailsModal
          bookingId={openId}
          role={role}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}


function BoardCard({
  booking,
  role,
  broadcastTimeoutSeconds,
  onOpen,
}: {
  booking: PipelineBooking;
  role: StaffRole | null;
  broadcastTimeoutSeconds: number;
  onOpen: () => void;
}) {
  const canAct = role === "super_admin" || role === "opsUncomprehensive" || role === "ops_manager";
  const isBroadcasting = booking.status === "accepted";

  // Live-ticking elapsed seconds since the booking entered 'accepted'.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isBroadcasting) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isBroadcasting]);
  const acceptedAtMs = isBroadcasting
    ? new Date(booking.updatedAt).getTime()
    : 0;
  const elapsedSec = isBroadcasting
    ? Math.max(0, Math.floor((nowMs - acceptedAtMs) / 1000))
    : 0;
  const timedOut = isBroadcasting && elapsedSec > broadcastTimeoutSeconds;

  // Eligible experts count for accepted (broadcasting) cards.
  const fetchCount = useServerFn(countEligibleExperts);
  const eligibleQuery = useQuery({
    queryKey: ["pipeline", "eligible-count", booking.id],
    queryFn: () => fetchCount({ data: { bookingId: booking.id } }),
    enabled: isBroadcasting,
    refetchInterval: isBroadcasting ? 15_000 : false,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });
  const eligibleCount = eligibleQuery.data?.count ?? null;

  return (
    <div
      onClick={onOpen}
      className={`bg-card border rounded-[12px] p-3 shadow-sm cursor-pointer transition-colors ${
        timedOut
          ? "border-warning bg-warning-tint/30"
          : "border-border hover:border-primary/60"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[13px] font-bold text-foreground truncate">
          {booking.customerName}
        </p>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          #{booking.id.slice(0, 6)}
        </span>
      </div>

      <div className="text-[12px] text-muted-foreground space-y-0.5">
        {(booking.serviceLabel || booking.serviceDurationMinutes) && (
          <p className="truncate">
            {booking.serviceLabel ??
              `${booking.serviceDurationMinutes} min service`}
            {booking.serviceDurationMinutes && booking.serviceLabel
              ? ` · ${booking.serviceDurationMinutes} min`
              : ""}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span>{formatTime(booking.createdAt)}</span>
          {booking.price != null && (
            <span className="font-semibold text-foreground">
              {inr.format(booking.price)}
            </span>
          )}
        </div>
        {booking.assignedExpertName && (
          <p className="truncate text-foreground">
            <span className="text-muted-foreground">Expert: </span>
            {booking.assignedExpertName}
          </p>
        )}
      </div>

      {isBroadcasting && (
        <div
          className={`mt-2 rounded-[10px] px-2 py-1.5 text-[11px] font-semibold flex items-center justify-between gap-2 border ${
            timedOut
              ? "border-warning text-warning bg-warning-tint/60"
              : "border-primary/30 text-primary bg-primary-tint"
          }`}
        >
          <span className="truncate">
            {timedOut
              ? "No response — assign manually"
              : `Broadcasting — ${formatElapsed(elapsedSec)}`}
          </span>
          <span className="shrink-0 font-bold">
            {eligibleQuery.isLoading && eligibleCount == null
              ? "…"
              : eligibleCount === 0
                ? "0 experts nearby"
                : `${eligibleCount ?? "—"} experts notified`}
          </span>
        </div>
      )}

      {canAct && booking.status === "confirmed" && (
        <ConfirmedActions bookingId={booking.id} />
      )}
      {canAct && booking.status === "accepted" && (
        <AssignExpertInline bookingId={booking.id} />
      )}
    </div>
  );
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}


function ConfirmedActions({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const acceptFn = useServerFn(acceptPendingBooking);
  const rejectFn = useServerFn(rejectPendingBooking);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState<RejectReason | "">("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    queryClient.invalidateQueries({ queryKey: ["live-orders"] });
  };

  const acceptMut = useMutation({
    mutationFn: () => acceptFn({ data: { bookingId } }),
    onSuccess: () => {
      toast.success("Booking accepted");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rejectMut = useMutation({
    mutationFn: (r: RejectReason) =>
      rejectFn({ data: { bookingId, reason: r } }),
    onSuccess: () => {
      toast.success("Booking rejected");
      invalidate();
      setRejectOpen(false);
      setReason("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="mt-3 pt-3 border-t border-border"
      onClick={(e) => e.stopPropagation()}
    >
      {!rejectOpen ? (
        <div className="flex items-center gap-2">
          <button
            disabled={acceptMut.isPending}
            onClick={() => acceptMut.mutate()}
            className="flex-1 h-8 rounded-[10px] bg-primary text-primary-foreground text-[12px] font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <Check size={13} />
            Accept
          </button>
          <button
            onClick={() => setRejectOpen(true)}
            className="flex-1 h-8 rounded-[10px] border border-destructive text-destructive text-[12px] font-bold inline-flex items-center justify-center gap-1 hover:bg-red-50"
          >
            <X size={13} />
            Reject
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as RejectReason | "")}
            className="w-full h-8 px-2 rounded-[10px] border border-border bg-card text-[12px]"
          >
            <option value="">Reason…</option>
            {REJECT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              disabled={!reason || rejectMut.isPending}
              onClick={() => reason && rejectMut.mutate(reason)}
              className="flex-1 h-8 rounded-[10px] bg-destructive text-white text-[12px] font-bold disabled:opacity-50"
            >
              {rejectMut.isPending ? "…" : "Confirm"}
            </button>
            <button
              onClick={() => {
                setRejectOpen(false);
                setReason("");
              }}
              className="flex-1 h-8 rounded-[10px] border border-border text-[12px] font-semibold"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignExpertInline({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const fetchExperts = useServerFn(listActiveExperts);
  const assignFn = useServerFn(assignExpertToBooking);
  const [expertId, setExpertId] = useState<string>("");

  const expertsQuery = useQuery({
    queryKey: ["pipeline", "assignable-experts", bookingId],
    queryFn: () => fetchExperts({ data: { bookingId } }),
  });

  const assignMut = useMutation({
    mutationFn: () => assignFn({ data: { bookingId, expertId } }),
    onSuccess: () => {
      toast.success("Expert assigned");
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      setExpertId("");
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Failed to assign";
      toast.error(msg);
      queryClient.invalidateQueries({ queryKey: ["pipeline", "board"] });
    },
  });

  return (
    <div
      className="mt-3 pt-3 border-t border-border space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={expertId}
        onChange={(e) => setExpertId(e.target.value)}
        className="w-full h-8 px-2 rounded-[10px] border border-border bg-card text-[12px]"
      >
        <option value="">
          {expertsQuery.isLoading
            ? "Loading experts…"
            : (expertsQuery.data ?? []).length === 0
              ? "No experts in zone"
              : "Assign expert…"}
        </option>
        {(expertsQuery.data ?? []).map((ex) => (
          <option key={ex.id} value={ex.id}>
            {ex.name}
          </option>
        ))}
      </select>
      <button
        disabled={!expertId || assignMut.isPending}
        onClick={() => assignMut.mutate()}
        className="w-full h-8 rounded-[10px] bg-primary text-primary-foreground text-[12px] font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"
      >
        <UserPlus size={13} />
        {assignMut.isPending ? "Assigning…" : "Confirm"}
      </button>
    </div>
  );
}
