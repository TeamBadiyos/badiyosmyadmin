import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Store, Volume2, VolumeX } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  listCommercePipeline,
  type CommerceOrder,
  type CommerceStatus,
} from "@/lib/commerce.functions";

const COLUMNS: Array<{ key: CommerceStatus; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed Today" },
];

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatPlacedAt(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Placed at ${time}`;
    return `Placed ${d.toLocaleDateString([], { day: "2-digit", month: "short" })}, ${time}`;
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
    osc.type = "triangle";
    // Distinct from the service pipeline alert (880Hz sine).
    osc.frequency.value = 620;
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    const beep = () => {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.13, t + 0.02);
      gain.gain.linearRampToValueAtTime(0, t + 0.3);
    };
    beep();
    const interval = window.setInterval(beep, 1800);
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

export function CommerceKanban({ segmentId }: { segmentId: string | null }) {
  const queryClient = useQueryClient();
  const fetchPipeline = useServerFn(listCommercePipeline);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["commerce", "board", segmentId],
    queryFn: () => fetchPipeline({ data: { segmentId } }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const channel = supabase
      .channel("commerce-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "merchant_orders" },
        () => queryClient.invalidateQueries({ queryKey: ["commerce", "board"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offline_sales" },
        () => queryClient.invalidateQueries({ queryKey: ["commerce", "board"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const grouped = useMemo(() => {
    const map = new Map<CommerceStatus, CommerceOrder[]>();
    COLUMNS.forEach((c) => map.set(c.key, []));
    for (const o of data?.orders ?? []) {
      const bucket = map.get(o.status);
      if (bucket) bucket.push(o);
    }
    return map;
  }, [data]);

  const pendingCount = (grouped.get("pending") ?? []).length;

  const audioRef = useRef<AudioHandle | null>(null);
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("commerce-audio-muted") === "1";
  });
  useEffect(() => {
    try {
      localStorage.setItem("commerce-audio-muted", muted ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [muted]);

  useEffect(() => {
    if (muted || pendingCount === 0) {
      stopBeep(audioRef);
      return;
    }
    startBeep(audioRef);
  }, [muted, pendingCount]);

  useEffect(() => () => stopBeep(audioRef), []);

  const offline = data?.offlineToday;

  return (
    <section className="bg-card border border-border rounded-[18px] p-4 sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold text-foreground">
            Commerce Operations
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            Live merchant orders — cards move as statuses change.
          </p>
          {isError && (
            <p className="text-[12px] text-destructive mt-1">
              Failed to load board
              {error instanceof Error && error.message ? `: ${error.message}` : ""}.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMuted((v) => !v)}
          className={`shrink-0 inline-flex items-center justify-center h-10 w-10 rounded-full border transition-colors ${
            muted
              ? "border-border text-muted-foreground hover:text-foreground bg-background"
              : "border-primary text-primary bg-primary-tint"
          }`}
          aria-pressed={muted}
          aria-label={muted ? "Unmute order alerts" : "Mute order alerts"}
          title={muted ? "Alerts muted — click to unmute" : "Alerts on — click to mute"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      <div className="mb-4 rounded-[12px] border border-border bg-background px-4 py-2.5 flex items-center gap-2 text-[12px]">
        <Store size={14} className="text-primary shrink-0" />
        <span className="text-muted-foreground">Offline POS today:</span>
        <span className="font-bold text-foreground">
          {offline ? `${offline.count} sales` : "—"}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="font-bold text-foreground">
          {offline ? inr.format(offline.revenue) : "—"}
        </span>
      </div>

      <div className="grid gap-4 grid-cols-[repeat(5,minmax(200px,1fr))] overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2">
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
                  <p className="text-[12px] text-muted-foreground px-1">Loading…</p>
                )}
                {!isLoading && items.length === 0 && (
                  <p className="text-[12px] text-muted-foreground px-1">No orders.</p>
                )}
                {items.map((o) => (
                  <div
                    key={o.id}
                    className="bg-card border border-border rounded-[12px] p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p className="text-[13px] font-bold text-foreground truncate">
                        {o.merchantName}
                      </p>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {o.orderNumber || `#${o.id.slice(0, 6)}`}
                      </span>
                    </div>
                    <div className="text-[12px] text-muted-foreground flex items-center justify-between gap-2">
                      <span className="truncate">{formatPlacedAt(o.createdAt)}</span>
                      <span className="font-semibold text-foreground shrink-0">
                        {inr.format(o.totalAmount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
