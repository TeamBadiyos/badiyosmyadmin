import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, LifeBuoy, Siren, UserSearch, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getStaffAlerts, type StaffAlert } from "@/lib/alerts.functions";

const ICONS = {
  support: LifeBuoy,
  emergency: Siren,
  needs_expert: UserSearch,
  extension: Clock,
} as const;

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationBell({
  onOpenTarget,
}: {
  onOpenTarget: (alert: StaffAlert) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const fetchAlerts = useServerFn(getStaffAlerts);

  const { data } = useQuery({
    queryKey: ["staff", "alerts"],
    queryFn: () => fetchAlerts(),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ["staff", "alerts"] });
    const channel = supabase
      .channel("staff-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_alerts" }, invalidate)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "booking_extensions" },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const total = data?.total ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${total ? ` (${total})` : ""}`}
        aria-expanded={open}
        className="relative w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Bell size={18} />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-h-[420px] overflow-y-auto bg-card border border-border rounded-[16px] shadow-lg z-50">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[13px] font-bold text-foreground">Needs attention</span>
            <span className="text-[11px] text-muted-foreground">{total} item(s)</span>
          </div>
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              You're all caught up.
            </p>
          )}
          {items.map((a) => {
            const Icon = ICONS[a.kind];
            return (
              <button
                key={a.id}
                onClick={() => {
                  setOpen(false);
                  onOpenTarget(a);
                }}
                className="w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-muted/40 flex gap-3"
              >
                <span
                  className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    a.kind === "emergency"
                      ? "bg-red-50 text-red-600"
                      : a.kind === "support"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-primary-tint text-primary"
                  }`}
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {a.title}
                  </span>
                  <span className="block text-[12px] text-muted-foreground line-clamp-2">
                    {a.detail}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {when(a.createdAt)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
