import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  ShoppingBag,
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
import {
  notifyEnabled,
  enableNotify,
  disableNotify,
  showBrowserNotification,
} from "@/lib/browser-notify";

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
  order: ShoppingBag,
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
  const panelRef = useRef<HTMLDivElement | null>(null);
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

  // ---- Live order events (shown in bell + Chrome) ----
  const [orderEvents, setOrderEvents] = useState<StaffAlert[]>([]);
  const [chromeOn, setChromeOn] = useState(false);
  useEffect(() => {
    setChromeOn(notifyEnabled());
    try {
      const raw = localStorage.getItem("cc-order-events");
      if (raw) setOrderEvents(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const saveEvents = (list: StaffAlert[]) => {
    setOrderEvents(list);
    try {
      localStorage.setItem("cc-order-events", JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };
  const eventsRef = useRef<StaffAlert[]>([]);
  eventsRef.current = orderEvents;
  const openRef = useRef(onOpenTarget);
  openRef.current = onOpenTarget;

  useEffect(() => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: ["staff", "alerts"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pushOrder = (title: string, detail: string, id: string, target: string, targetId: string | null) => {
      if (eventsRef.current.some((e) => e.id === id)) return;
      const ev: StaffAlert = {
        id,
        kind: "order" as StaffAlert["kind"],
        title,
        detail,
        createdAt: new Date().toISOString(),
        target,
        targetId,
        readAt: null,
        dismissedAt: null,
      };
      saveEvents([ev, ...eventsRef.current].slice(0, 30));
      showBrowserNotification(title, detail, id, () => openRef.current(ev));
    };
    const channel = supabase
      .channel(`staff-alerts-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings" }, (p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = p.new as any;
        if (r?.is_training) return;
        const amt = r?.total_amount ?? r?.amount;
        pushOrder(
          "🛒 New order",
          `${r?.service_label ?? "Service booking"}${amt != null ? ` — ₹${Math.round(Number(amt))}` : ""}`,
          `order:${r?.id}`,
          "bookings",
          r?.id ?? null,
        );
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "courier_orders" }, (p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = p.new as any;
        pushOrder("📦 New courier order", `Order ${String(r?.id ?? "").slice(0, 8)}`, `courier:${r?.id}`, "courier", null);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "merchant_orders" }, (p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = p.new as any;
        pushOrder("🛍️ New store order", `Order ${String(r?.id ?? "").slice(0, 8)}`, `store:${r?.id}`, "dashboard", null);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "merchants" }, refresh)
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
    const poll = setInterval(refresh, 30_000);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  // Chrome popup for every new unread feed item (merchant, ticket, emergency, leads...)
  const seenRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (filter !== "unread" || !data) return;
    const ids = data.items.filter((a) => !a.readAt && !a.dismissedAt);
    if (seenRef.current === null) {
      seenRef.current = new Set(ids.map((a) => a.id));
      return;
    }
    for (const a of ids) {
      if (seenRef.current.has(a.id)) continue;
      seenRef.current.add(a.id);
      showBrowserNotification(a.title, a.detail, a.id, () => openRef.current(a));
    }
  }, [data, filter]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const unreadOrders = orderEvents.filter((e) => !e.readAt && !e.dismissedAt);
  const total = (data?.total ?? 0) + unreadOrders.length;
  const localShown =
    filter === "unread"
      ? unreadOrders
      : filter === "dismissed"
        ? orderEvents.filter((e) => e.dismissedAt)
        : orderEvents.filter((e) => !e.dismissedAt);
  const items = [...localShown, ...(data?.items ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const isLocal = (id: string) => orderEvents.some((e) => e.id === id);
  const patchLocal = (id: string, patch: Partial<StaffAlert>) =>
    saveEvents(orderEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  async function toggleChrome() {
    if (chromeOn) {
      disableNotify();
      setChromeOn(false);
      return;
    }
    const ok = await enableNotify();
    setChromeOn(ok);
    if (ok) showBrowserNotification("Notifications on", "You'll get Chrome alerts for new activity.", "test");
    else alert("Chrome notifications are blocked. Allow them from the lock icon in the address bar.");
  }


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

      {open && typeof document !== "undefined" && createPortal(
        <>
        <button
          aria-label="Close notifications"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-foreground/20 sm:hidden"
        />
        <div ref={panelRef} className="fixed left-3 right-3 top-[72px] sm:left-auto sm:right-6 sm:w-[380px] max-h-[75dvh] overflow-hidden flex flex-col bg-card border border-border rounded-[16px] shadow-lg z-50">
          <div className="px-4 pt-3 pb-2 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-foreground">Notifications</span>
              <span className="text-[11px] text-muted-foreground">{total} unread</span>
            </div>
            <button
              onClick={toggleChrome}
              className={`mt-2 w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                chromeOn ? "bg-primary-tint text-primary" : "bg-muted text-foreground"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <BellRing size={13} /> Chrome notifications
              </span>
              <span>{chromeOn ? "ON" : "Turn on"}</span>
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
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
                onClick={() => {
                  const now = new Date().toISOString();
                  saveEvents(orderEvents.map((e) => ({ ...e, readAt: e.readAt ?? now })));
                  readAll.mutate();
                }}
                title="Mark all as read"
                className="px-2 py-1 rounded-md text-[11px] font-semibold text-muted-foreground hover:bg-muted flex items-center gap-1"
              >
                <CheckCheck size={13} /> Read all
              </button>
              <button
                onClick={() => {
                  const now = new Date().toISOString();
                  saveEvents(orderEvents.map((e) => ({ ...e, dismissedAt: e.dismissedAt ?? now })));
                  clearAll.mutate();
                }}
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
              const Icon = ICONS[a.kind as keyof typeof ICONS] ?? Bell;
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
                      if (isLocal(a.id)) patchLocal(a.id, { readAt: new Date().toISOString() });
                      else readOne.mutate(a.id);
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
                      isLocal(a.id)
                        ? patchLocal(a.id, { dismissedAt: a.dismissedAt ? null : new Date().toISOString() })
                        : dismissOne.mutate({ id: a.id, dismissed: !a.dismissedAt })
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
        </>,
        document.body,
      )}
    </div>
  );
}
