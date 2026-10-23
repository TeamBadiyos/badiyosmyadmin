import { useEffect, useMemo, useRef, useState } from "react";
import { formatPhone } from "@/lib/phone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, MapPin, Phone, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  acknowledgeEmergencyAlert,
  listEmergencyAlerts,
  type EmergencyAlert,
} from "@/lib/emergency.functions";
import { BookingDetailsModal } from "@/components/booking-details-modal";
import type { StaffRole } from "@/lib/staff.functions";

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
    osc.frequency.value = 660;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const beep = () => {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.28);
    };
    beep();
    const interval = window.setInterval(beep, 1400);
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    ref.current = { ctx, osc, gain, interval };
  } catch {
    /* audio unsupported */
  }
}

function stopBeep(ref: React.MutableRefObject<AudioHandle | null>) {
  const h = ref.current;
  if (!h) return;
  ref.current = null;
  window.clearInterval(h.interval);
  try {
    h.osc.stop();
  } catch {
    /* noop */
  }
  h.ctx.close().catch(() => {});
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
  } catch {
    return iso;
  }
}

export function EmergencyAlertsPage({ role }: { role: StaffRole | null }) {
  const queryClient = useQueryClient();
  const fetchAlerts = useServerFn(listEmergencyAlerts);
  const ackAlert = useServerFn(acknowledgeEmergencyAlert);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [chip, setChip] = useState<"open" | "ack" | "all">("open");

  const canAck = role === "super_admin" || role === "ops_manager";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["emergency", "alerts"],
    queryFn: () => fetchAlerts(),
    refetchInterval: 60_000,
  });

  // Realtime: same pattern as the pipeline board.
  useEffect(() => {
    const channel = supabase
      .channel("emergency-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "emergency_alerts" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["emergency", "alerts"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const alerts = useMemo(() => data ?? [], [data]);
  const isAck = (a: EmergencyAlert) => a.status === "acknowledged" || a.status === "resolved";
  const shown = alerts.filter((a) => (chip === "all" ? true : chip === "ack" ? isAck(a) : !isAck(a)));
  const openCount = alerts.filter((a) => a.status !== "acknowledged" && a.status !== "resolved").length;

  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("emergency-audio-muted") === "1";
  });
  useEffect(() => {
    try {
      localStorage.setItem("emergency-audio-muted", muted ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [muted]);

  const audioRef = useRef<AudioHandle | null>(null);
  useEffect(() => {
    if (!muted && openCount > 0) startBeep(audioRef);
    else stopBeep(audioRef);
  }, [muted, openCount]);
  useEffect(() => () => stopBeep(audioRef), []);

  const ackMutation = useMutation({
    mutationFn: (alertId: string) => ackAlert({ data: { alertId } }),
    onSuccess: () => {
      toast.success("Alert acknowledged");
      queryClient.invalidateQueries({ queryKey: ["emergency", "alerts"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to acknowledge";
      toast.error(msg.includes("insufficient_role") ? "You don't have permission for this action" : msg);
    },
  });

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-1.5">
          {([["open", `Unacknowledged (${openCount})`], ["ack", "Acknowledged"], ["all", "All"]] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setChip(k)}
              className={`h-8 px-3 rounded-full text-[12px] font-bold border ${chip === k ? (k === "open" && openCount > 0 ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary") : "bg-card border-border text-muted-foreground hover:bg-muted/40"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={muted ? "Unmute alerts" : "Mute alerts"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          {muted ? "Muted" : "Sound on"}
        </button>
      </div>

      {isError && <p className="text-[14px] text-destructive">Failed to load alerts.</p>}
      {isLoading && !data && <p className="text-[14px] text-muted-foreground">Loading…</p>}
      {!isLoading && shown.length === 0 && (
        <p className="text-[14px] text-muted-foreground py-8 text-center">{chip === "open" ? "No unacknowledged SOS. All clear." : "No SOS alerts."}</p>
      )}

      <div className="space-y-3">
        {shown.map((a: EmergencyAlert) => {
          const isOpen = a.status !== "acknowledged" && a.status !== "resolved";
          const hasCoords = a.latitude !== null && a.longitude !== null;
          return (
            <div
              key={a.id}
              className={`rounded-[18px] border p-5 flex flex-col gap-3 ${
                isOpen
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                    {isOpen && <AlertTriangle size={16} className="text-destructive shrink-0" />}
                    {a.expertName ?? "Unknown expert"}
                  </p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {formatWhen(a.createdAt)}
                    {a.expertPhone ? (
                      <a
                        href={`tel:${a.expertPhone}`}
                        className="ml-3 inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Phone size={13} /> {formatPhone(a.expertPhone)}
                      </a>
                    ) : null}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide ${
                    isOpen
                      ? "bg-destructive text-destructive-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                {a.bookingId ? (
                  <button
                    type="button"
                    onClick={() => setSelectedBookingId(a.bookingId!)}
                    className="text-primary font-medium hover:underline"
                  >
                    Booking #{a.bookingId.slice(0, 8)}
                  </button>
                ) : (
                  <span className="text-muted-foreground">No linked booking</span>
                )}
                {hasCoords ? (
                  <a
                    href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
                  >
                    <MapPin size={14} />
                    {a.latitude!.toFixed(5)}, {a.longitude!.toFixed(5)}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No location</span>
                )}
              </div>

              {a.notes && <p className="text-[13px] text-foreground/80">{a.notes}</p>}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-muted-foreground">
                  {a.acknowledgedAt
                    ? `Acknowledged ${formatWhen(a.acknowledgedAt)}${
                        a.acknowledgedByName ? ` by ${a.acknowledgedByName}` : ""
                      }`
                    : ""}
                </p>
                {isOpen && canAck && (
                  <button
                    type="button"
                    disabled={ackMutation.isPending}
                    onClick={() => ackMutation.mutate(a.id)}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
                  >
                    <Check size={15} /> Acknowledge
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedBookingId && (
        <BookingDetailsModal
          bookingId={selectedBookingId}
          role={role}
          onClose={() => setSelectedBookingId(null)}
        />
      )}
    </div>
  );
}
