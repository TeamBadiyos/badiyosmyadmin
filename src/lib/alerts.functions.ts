import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AlertKind =
  | "support"
  | "needs_expert"
  | "emergency"
  | "extension"
  | "merchant"
  | "skill"
  | "expert"
  | "deletion"
  | "lead"
  | "waitlist"
  | "payout";

export type StaffAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  detail: string;
  createdAt: string;
  /** Nav key of the Command Center screen this alert links to. */
  target: string;
  targetId: string | null;
  readAt: string | null;
  dismissedAt: string | null;
};

export type StaffAlerts = {
  /** Unread, non-dismissed count across all notifications. */
  total: number;
  items: StaffAlert[];
  /** Open support tickets, used for the sidebar badge. */
  openTickets: number;
};

export type AlertFilter = "unread" | "all" | "dismissed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): StaffAlert {
  return {
    id: r.id as string,
    kind: (r.kind as AlertKind) ?? "support",
    title: (r.title as string) ?? "Notification",
    detail: (r.detail as string) ?? "",
    createdAt: (r.event_at as string) ?? new Date().toISOString(),
    target: (r.target as string) ?? "dashboard",
    targetId: (r.target_id as string | null) ?? null,
    readAt: (r.read_at as string | null) ?? null,
    dismissedAt: (r.dismissed_at as string | null) ?? null,
  };
}

export const getStaffAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { filter?: AlertFilter } | undefined) => ({
    filter: input?.filter ?? "unread",
  }))
  .handler(async ({ context, data }): Promise<StaffAlerts> => {
    const db = context.supabase;

    const { data: staff } = await db
      .from("staff_users")
      .select("role, status")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    // Refresh the notification feed from live conditions, then read it back.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const syncRes = await (db as any).rpc("staff_sync_notifications");
    if (syncRes.error) throw new Error(syncRes.error.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (db as any).rpc("staff_list_notifications", {
      _filter: data.filter,
    });
    if (error) throw new Error(error.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (rows ?? []) as any[];
    let total = list.length ? Number(list[0].unread_total ?? 0) : 0;

    // The unread total only rides along on returned rows, so a filter that
    // returns nothing (e.g. an empty "Cleared" tab) would hide a real count.
    if (!list.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: unreadRows } = await (db as any).rpc("staff_list_notifications", {
        _filter: "unread",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (unreadRows ?? []) as any[];
      total = u.length ? Number(u[0].unread_total ?? 0) : 0;
    }

    const { count } = await db
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "in_progress"]);

    return {
      total,
      items: list.map(mapRow),
      openTickets: count ?? 0,
    };
  });

export const markAlertRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; read?: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return { id: input.id, read: input.read ?? true };
  })
  .handler(async ({ context, data }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_mark_notification_read", {
      _id: data.id,
      _read: data.read,
    });
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });

export const markAllAlertsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc(
      "staff_mark_all_notifications_read",
    );
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });

export const dismissAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; dismissed?: boolean }) => {
    if (!input?.id) throw new Error("id required");
    return { id: input.id, dismissed: input.dismissed ?? true };
  })
  .handler(async ({ context, data }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_dismiss_notification", {
      _id: data.id,
      _dismissed: data.dismissed,
    });
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });

export const clearAllAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_clear_notifications");
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });
