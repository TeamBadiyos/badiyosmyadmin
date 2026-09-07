import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TicketStatus = "open" | "in_progress" | "resolved";

export type SupportTicket = {
  id: string;
  message: string;
  status: TicketStatus;
  source: string;
  internalNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  userName: string | null;
  userPhone: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireStaff(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  if (!["super_admin", "ops_manager"].includes(data.role)) throw new Error("Forbidden");
  return data as { role: string; status: string };
}

export const listSupportTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { status?: string | null; source?: string | null } | undefined) => input ?? {},
  )
  .handler(async ({ data, context }): Promise<SupportTicket[]> => {
    await requireStaff(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = context.supabase
      .from("support_tickets")
      .select("id, user_id, message, status, source, internal_note, created_at, resolved_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && ["open", "in_progress", "resolved"].includes(data.status)) {
      q = q.eq("status", data.status);
    }
    if (data.source && ["customer", "partner", "merchant"].includes(data.source)) {
      q = q.eq("source", data.source);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];

    const userIds = Array.from(new Set(raw.map((r) => r.user_id).filter(Boolean)));
    const userMap = new Map<string, { name: string | null; phone: string | null }>();
    if (userIds.length) {
      const { data: users } = await context.supabase
        .from("users")
        .select("id, full_name, phone")
        .in("id", userIds);
      for (const u of (users ?? []) as Array<{
        id: string;
        full_name: string | null;
        phone: string | null;
      }>) {
        if (u.full_name || u.phone) userMap.set(u.id, { name: u.full_name, phone: u.phone });
      }

      // Partner-app tickets carry the expert's auth user id; merchant-app the merchant's.
      const missing = userIds.filter((id) => !userMap.get(id)?.name);
      if (missing.length) {
        const { data: experts } = await context.supabase
          .from("experts")
          .select("auth_user_id, name, phone")
          .in("auth_user_id", missing);
        for (const e of (experts ?? []) as Array<{
          auth_user_id: string | null;
          name: string | null;
          phone: string | null;
        }>) {
          if (e.auth_user_id) userMap.set(e.auth_user_id, { name: e.name, phone: e.phone });
        }
        const stillMissing = missing.filter((id) => !userMap.get(id)?.name);
        if (stillMissing.length) {
          const { data: merchants } = await context.supabase
            .from("merchants")
            .select("auth_user_id, store_name, owner_name, phone")
            .in("auth_user_id", stillMissing);
          for (const m of (merchants ?? []) as Array<{
            auth_user_id: string | null;
            store_name: string | null;
            owner_name: string | null;
            phone: string | null;
          }>) {
            if (m.auth_user_id)
              userMap.set(m.auth_user_id, {
                name: m.owner_name ?? m.store_name,
                phone: m.phone,
              });
          }
        }
      }
    }

    return raw.map((r) => ({
      id: r.id,
      message: r.message,
      status: r.status as TicketStatus,
      source: r.source ?? "customer",
      internalNote: r.internal_note ?? null,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at ?? null,
      userName: r.user_id ? (userMap.get(r.user_id)?.name ?? null) : null,
      userPhone: r.user_id ? (userMap.get(r.user_id)?.phone ?? null) : null,
    }));
  });

export const updateSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      ticketId: string;
      status: TicketStatus;
      note?: string | null;
      resolution?: string | null;
    }) => {
    if (!input?.ticketId) throw new Error("ticketId required");
    if (!["open", "in_progress", "resolved"].includes(input.status))
      throw new Error("Invalid status");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_support_ticket", {
      _ticket_id: data.ticketId,
      _status: data.status,
      _note: data.note?.trim() ? data.note.trim() : undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
