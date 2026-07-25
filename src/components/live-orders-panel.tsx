import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  acceptPendingBooking,
  assignExpertToBooking,
  listActiveExperts,
  listPendingBookings,
  rejectPendingBooking,
  REJECT_REASONS,
  type ActiveExpert,
  type PendingBooking,
  type RejectReason,
} from "@/lib/live-orders.functions";


const REASON_LABELS: Record<RejectReason, string> = {
  CHANGED_MIND: "Changed mind",
  NO_RESPONSE: "No response",
  DUPLICATE: "Duplicate",
  OTHER: "Other",
};

type LocalState =
  | { kind: "pending" }
  | { kind: "accepted" }
  | { kind: "rejecting" };

export function LiveOrdersPanel() {
  const queryClient = useQueryClient();
  const fetchPending = useServerFn(listPendingBookings);
  const fetchExperts = useServerFn(listActiveExperts);
  const accept = useServerFn(acceptPendingBooking);
  const reject = useServerFn(rejectPendingBooking);
  const assign = useServerFn(assignExpertToBooking);

  const { data, isLoading } = useQuery({
    queryKey: ["live-orders", "pending"],
    queryFn: () => fetchPending(),
    refetchOnWindowFocus: false,
  });

  // Realtime subscription — invalidate on any bookings change.
  useEffect(() => {
    const channel = supabase
      .channel("live-orders-bookings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["live-orders", "pending"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const items = data ?? [];

  // Track per-card state (accepted → show dropdown; rejecting → show reason UI).
  const [localState, setLocalState] = useState<Record<string, LocalState>>({});

  const acceptedIds = useMemo(
    () => new Set(Object.entries(localState).filter(([, s]) => s.kind === "accepted").map(([id]) => id)),
    [localState],
  );

  // Play looping beep while any card is still awaiting action.
  const audioRef = useRef<{
    ctx: AudioContext;
    osc: OscillatorNode;
    gain: GainNode;
    interval: number;
  } | null>(null);

  // Determine "unacted" ids — those in the list that we haven't accepted/rejected locally.
  const unactedIds = useMemo(
    () =>
      items
        .map((b) => b.id)
        .filter((id) => {
          const s = localState[id];
          return !s || s.kind === "rejecting";
        }),
    [items, localState],
  );

  const prevSeenRef = useRef<Set<string>>(new Set());
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [showEnablePrompt, setShowEnablePrompt] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("live-orders-audio-prompt-dismissed") !== "1";
  });
  function dismissEnablePrompt() {
    sessionStorage.setItem("live-orders-audio-prompt-dismissed", "1");
    setShowEnablePrompt(false);
  }

  useEffect(() => {
    // Detect newly arrived bookings for a subtle "new" fade indicator.
    const seen = prevSeenRef.current;
    const nextIds = new Set(items.map((b) => b.id));
    prevSeenRef.current = nextIds;
    // Nothing else needed — sound handled below.
    void seen;
  }, [items]);

  useEffect(() => {
    if (!audioEnabled) return;
    if (unactedIds.length === 0) {
      stopBeep(audioRef);
      return;
    }
    startBeep(audioRef);
    return () => {
      // don't stop on re-run; only stop when unacted becomes empty
    };
  }, [audioEnabled, unactedIds.length]);

  useEffect(() => {
    return () => stopBeep(audioRef);
  }, []);

  const acceptMutation = useMutation({
    mutationFn: (bookingId: string) => accept({ data: { bookingId } }),
    onSuccess: (_res, bookingId) => {
      setLocalState((s) => ({ ...s, [bookingId]: { kind: "accepted" } }));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (v: { bookingId: string; reason: RejectReason }) =>
      reject({ data: v }),
    onSuccess: (_res, v) => {
      setLocalState((s) => {
        const { [v.bookingId]: _drop, ...rest } = s;
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: ["live-orders", "pending"] });
    },
  });

  // Experts are now fetched per-card, filtered by that booking's zone.


  const [assignError, setAssignError] = useState<Record<string, string>>({});
  const assignMutation = useMutation({
    mutationFn: (v: { bookingId: string; expertId: string }) =>
      assign({ data: v }),
    onSuccess: (_res, v) => {
      setAssignError((e) => {
        const { [v.bookingId]: _drop, ...rest } = e;
        return rest;
      });
      setLocalState((s) => {
        const { [v.bookingId]: _drop, ...rest } = s;
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: ["live-orders", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: (err, v) => {
      setAssignError((e) => ({
        ...e,
        [v.bookingId]:
          err instanceof Error ? err.message : "Failed to assign expert",
      }));
    },
  });

  return (
    <aside className="w-full lg:w-[360px] shrink-0 lg:sticky lg:top-20 self-start">
      <div className="bg-card border border-border rounded-[18px] flex flex-col max-h-[calc(100vh-6rem)]">
        <div className="p-5 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-foreground">Live Orders</h2>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {unactedIds.length} awaiting action
            </p>
          </div>
          <button
            onClick={() => setAudioEnabled((v) => !v)}
            className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              audioEnabled
                ? "border-primary text-primary bg-primary-tint"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={audioEnabled}
          >
            {audioEnabled ? "Sound on" : "Sound off"}
          </button>
        </div>
        {showEnablePrompt && !audioEnabled && (
          <div className="px-4 pt-4">
            <div className="flex items-start gap-3 p-3 rounded-[14px] bg-primary-tint border border-primary/30">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground">Enable order alerts?</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">Play a sound when new bookings arrive.</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setAudioEnabled(true); dismissEnablePrompt(); }}
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
          </div>
        )}


        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading && items.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-8">
              Loading…
            </p>
          )}
          {!isLoading && items.length === 0 && (
            <p className="text-[13px] text-muted-foreground text-center py-8">
              No live orders right now.
            </p>
          )}
          {items.map((b) => (
            <OrderCard
              key={b.id}
              booking={b}
              state={localState[b.id]}
              accepting={acceptMutation.isPending && acceptMutation.variables === b.id}
              rejecting={
                rejectMutation.isPending && rejectMutation.variables?.bookingId === b.id
              }
              assigning={
                assignMutation.isPending && assignMutation.variables?.bookingId === b.id
              }
              assignError={assignError[b.id]}
              fetchExperts={fetchExperts}

              onAccept={() => acceptMutation.mutate(b.id)}
              onStartReject={() =>
                setLocalState((s) => ({ ...s, [b.id]: { kind: "rejecting" } }))
              }
              onCancelReject={() =>
                setLocalState((s) => {
                  const { [b.id]: _drop, ...rest } = s;
                  return rest;
                })
              }
              onConfirmReject={(reason) =>
                rejectMutation.mutate({ bookingId: b.id, reason })
              }
              onAssign={(expertId) =>
                assignMutation.mutate({ bookingId: b.id, expertId })
              }
              isAccepted={acceptedIds.has(b.id)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function OrderCard(props: {
  booking: PendingBooking;
  state: LocalState | undefined;
  accepting: boolean;
  rejecting: boolean;
  assigning: boolean;
  assignError: string | undefined;
  fetchExperts: (opts?: { data?: { bookingId?: string | null } }) => Promise<ActiveExpert[]>;
  isAccepted: boolean;
  onAccept: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onConfirmReject: (r: RejectReason) => void;
  onAssign: (expertId: string) => void;
}) {
  const {
    booking: b,
    state,
    accepting,
    rejecting,
    assigning,
    assignError,
    fetchExperts,
    isAccepted,
    onAccept,
    onStartReject,
    onCancelReject,
    onConfirmReject,
    onAssign,
  } = props;
  const [reason, setReason] = useState<RejectReason>("CHANGED_MIND");
  const [selectedExpert, setSelectedExpert] = useState<string>("");

  const { data: experts = [] } = useQuery({
    queryKey: ["live-orders", "experts", b.id],
    queryFn: () => fetchExperts({ data: { bookingId: b.id } }),
    enabled: isAccepted,
    staleTime: 15_000,
  });


  const timeAgo = useMemo(() => formatShortTime(b.createdAt), [b.createdAt]);

  return (
    <div className="border border-border rounded-[14px] p-4 bg-card animate-in fade-in duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-foreground truncate">
            {b.customerName}
          </p>
          <p className="text-[13px] text-muted-foreground mt-0.5 truncate">
            {b.serviceLabel ?? "Service"}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo}</span>
      </div>

      <div className="mt-3 space-y-1 text-[12px] text-muted-foreground">
        {(b.scheduledDate || b.scheduledTimeSlot) && (
          <p className="truncate">
            <span className="text-foreground font-semibold">Slot:</span>{" "}
            {[b.scheduledDate, b.scheduledTimeSlot].filter(Boolean).join(" · ")}
          </p>
        )}
        {b.addressShort && (
          <p className="truncate">
            <span className="text-foreground font-semibold">Address:</span>{" "}
            {b.addressShort}
          </p>
        )}
      </div>

      {isAccepted ? (
        <div className="mt-4 space-y-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Assign expert
          </label>
          <div className="relative">
            <select
              value={selectedExpert}
              onChange={(e) => setSelectedExpert(e.target.value)}
              disabled={assigning}
              className="w-full appearance-none bg-card border border-border rounded-[14px] px-3 py-2.5 text-[13px] text-foreground disabled:opacity-60"
            >
              <option value="">
                {experts.length === 0 ? "No active experts" : "Select expert…"}
              </option>
              {experts.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} · {ex.phone}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>
          <button
            onClick={() => selectedExpert && onAssign(selectedExpert)}
            disabled={!selectedExpert || assigning}
            className="w-full h-10 rounded-[14px] bg-primary text-white text-[13px] font-bold disabled:opacity-60"
          >
            {assigning ? "Assigning…" : "Confirm assignment"}
          </button>
          {assignError && (
            <p className="text-[12px] text-destructive">{assignError}</p>
          )}
        </div>
      ) : state?.kind === "rejecting" ? (
        <div className="mt-4 space-y-2">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reject reason
          </label>
          <div className="relative">
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as RejectReason)}
              className="w-full appearance-none bg-card border border-border rounded-[14px] px-3 py-2.5 text-[13px] text-foreground"
            >
              {REJECT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABELS[r]}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancelReject}
              disabled={rejecting}
              className="flex-1 h-10 rounded-[14px] border border-border text-[13px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirmReject(reason)}
              disabled={rejecting}
              className="flex-1 h-10 rounded-[14px] bg-destructive text-white text-[13px] font-bold disabled:opacity-60"
            >
              {rejecting ? "Rejecting…" : "Confirm"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            onClick={onAccept}
            disabled={accepting}
            className="flex-1 h-10 rounded-[14px] bg-primary text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Check size={16} />
            {accepting ? "Accepting…" : "Accept"}
          </button>
          <button
            onClick={onStartReject}
            className="flex-1 h-10 rounded-[14px] border border-destructive text-destructive text-[13px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-destructive/5"
          >
            <X size={16} />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function formatShortTime(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

// --- Audio (Web Audio API beep loop; placeholder notification tone) ---
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
    // audio unsupported — silent no-op
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
