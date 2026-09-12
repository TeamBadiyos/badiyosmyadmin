import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  LifeBuoy,
  Siren,
  UserSearch,
  Clock,
  Store,
  BadgeCheck,
  UserPlus,
  Trash2,
  Sparkles,
  ListChecks,
  Wallet,
  X,
  CheckCheck,
  BellRing,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getStaffAlerts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  clearAllAlerts,
  type AlertFilter,
  type StaffAlert,
} from "@/lib/alerts.functions";

const ICONS = {
  support: LifeBuoy,
  emergency: Siren,
  needs_expert: UserSearch,
  extension: Clock,
  merchant: Store,
  skill: BadgeCheck,
  expert: UserPlus,
  deletion: Trash2,
  lead: Sparkles,
  waitlist: ListChecks,
  payout: Wallet,
  dispatch: BellRing,
} as const;

const TABS: { key: AlertFilter; label: string }[] = [
  { key: "unread", label: "Unread" },
  { key: "all", label: "All" },
  { key: "dismissed", label: "Cleared" },
];

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
  const [filter, setFilter] = useState<AlertFilter>("unread");
  const ref = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const fetchAlerts = useServerFn(getStaffAlerts);
  const readFn = useServerFn(markAlertRead);
  const readAllFn = useServerFn(markAllAlertsRead);
  const dismissFn = useServerFn(dismissAlert);
  const clearFn = useServerFn(clearAllAlerts);

  const { data } = useQuery({
    queryKey: ["staff", "alerts", filter],
    queryFn: () => fetchAlerts({ data: { filter } }),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["staff", "alerts"] });

  const readOne = useMutation({
    mutationFn: (id: string) => readFn({ data: { id } }),
    onSuccess: invalidate,
  });
  const readAll = useMutation({ mutationFn: () => readAllFn(), onSuccess: invalidate });
  const dismissOne = useMutation({
    mutationFn: (vars: { id: string; dismissed: boolean }) => dismissFn({ data: vars }),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({ mutationFn: () => clearFn(), onSuccess: invalidate });

  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["staff", "alerts"] });
    const channel = supabase
      .channel("staff-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "emergency_alerts" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "booking_extensions" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch_alert_events" },
        refresh,
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
        <div className="absolute right-0 mt-2 w-[360px] max-h-[460px] overflow-hidden flex flex-col bg-card border border-border rounded-[16px] shadow-lg z-50">
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-foreground">Notifications</span>
              <span className="text-[11px] text-muted-foreground">{total} unread</span>
            </div>
            <div className="mt-2 flex items-center gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    filter === t.key
                      ? "bg-primary-tint text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <span className="flex-1" />
              <button
                onClick={() => readAll.mutate()}
                title="Mark all as read"
                className="px-2 py-1 rounded-md text-[11px] font-semibold text-muted-foreground hover:bg-muted flex items-center gap-1"
              >
                <CheckCheck size={13} /> Read all
              </button>
              <button
                onClick={() => clearAll.mutate()}
                title="Clear all"
                className="px-2 py-1 rounded-md text-[11px] font-semibold text-destructive hover:bg-muted"
              >
                Clear all
              </button>
            </div>
          </div>

          <div className="overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                You're all caught up.
              </p>
            )}
            {items.map((a) => {
              const Icon = ICONS[a.kind] ?? Bell;
              const unread = !a.readAt;
              return (
                <div
                  key={a.id}
                  className={`group flex gap-2 border-b border-border last:border-0 ${
                    unread ? "bg-primary-tint/40" : ""
                  }`}
                >
                  <button
                    onClick={() => {
                      setOpen(false);
                      readOne.mutate(a.id);
                      onOpenTarget(a);
                    }}
                    className="flex-1 text-left pl-4 pr-1 py-3 hover:bg-muted/40 flex gap-3 min-w-0"
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
                        {unread && (
                          <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle" />
                        )}
                      </span>
                      <span className="block text-[12px] text-muted-foreground line-clamp-2">
                        {a.detail}
                      </span>
                      <span className="block text-[11px] text-muted-foreground mt-0.5">
                        {when(a.createdAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      dismissOne.mutate({ id: a.id, dismissed: !a.dismissedAt })
                    }
                    aria-label={a.dismissedAt ? "Restore notification" : "Dismiss notification"}
                    title={a.dismissedAt ? "Restore" : "Dismiss"}
                    className="px-3 text-muted-foreground hover:text-foreground"
                  >
                    {a.dismissedAt ? (
                      <span className="text-[11px] font-semibold">Undo</span>
                    ) : (
                      <X size={14} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
