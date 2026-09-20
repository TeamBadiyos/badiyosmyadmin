import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TicketStatus = "open" | "in_progress" | "answered" | "resolved";

export type SupportTicket = {
  id: string;
  userId: string | null;
  subject: string | null;
  message: string;
  status: TicketStatus;
  source: string;
  internalNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageFrom: "staff" | "customer" | null;
  userName: string | null;
  userPhone: string | null;
};

export type TicketMessage = {
  id: string;
  senderType: "staff" | "customer";
  body: string;
  createdAt: string;
};

export type TicketContact = {
  role: "customer" | "expert" | "merchant" | "unknown";
  name: string | null;
  phone: string | null;
  email: string | null;
  joinedAt: string | null;
  language: string | null;
  deletedAt: string | null;
  address: string | null;
  coinBalance: number;
  stats: { bookings: number; completed: number; cancelled: number; spend: number };
  bookings: Array<{
    id: string;
    createdAt: string | null;
    serviceLabel: string | null;
    price: number;
    status: string;
  }>;
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
      .select(
        "id, user_id, subject, message, status, source, internal_note, created_at, resolved_at, last_message_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status && ["open", "in_progress", "answered", "resolved"].includes(data.status)) {
      q = q.eq("status", data.status);
    }
    if (data.source && ["customer", "partner", "merchant"].includes(data.source)) {
      q = q.eq("source", data.source);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];

    // Last message per ticket (for the inbox preview)
    const ticketIds = raw.map((r) => r.id);
    const lastMap = new Map<string, { body: string; sender: "staff" | "customer" }>();
    if (ticketIds.length) {
      const { data: msgs } = await context.supabase
        .from("support_ticket_messages")
        .select("ticket_id, body, sender_type, created_at")
        .in("ticket_id", ticketIds)
        .order("created_at", { ascending: true });
      for (const m of (msgs ?? []) as Array<{
        ticket_id: string;
        body: string;
        sender_type: string;
      }>) {
        lastMap.set(m.ticket_id, {
          body: m.body,
          sender: m.sender_type === "staff" ? "staff" : "customer",
        });
      }
    }

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

    const tickets: SupportTicket[] = raw.map((r) => {
      const last = lastMap.get(r.id);
      return {
        id: r.id,
        userId: r.user_id ?? null,
        subject: r.subject ?? null,
        message: r.message,
        status: (r.status ?? "open") as TicketStatus,
        source: r.source ?? "customer",
        internalNote: r.internal_note ?? null,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at ?? null,
        lastMessageAt: r.last_message_at ?? r.created_at,
        lastMessagePreview: last?.body ?? r.message,
        lastMessageFrom: last?.sender ?? "customer",
        userName: r.user_id ? (userMap.get(r.user_id)?.name ?? null) : null,
        userPhone: r.user_id ? (userMap.get(r.user_id)?.phone ?? null) : null,
      };
    });

    tickets.sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.createdAt).getTime() -
        new Date(a.lastMessageAt ?? a.createdAt).getTime(),
    );
    return tickets;
  });

export const listTicketMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticketId: string }) => {
    if (!input?.ticketId) throw new Error("ticketId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<TicketMessage[]> => {
    await requireStaff(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("support_ticket_messages")
      .select("id, sender_type, body, created_at")
      .eq("ticket_id", data.ticketId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<{
      id: string;
      sender_type: string;
      body: string;
      created_at: string;
    }>).map((m) => ({
      id: m.id,
      senderType: m.sender_type === "staff" ? "staff" : "customer",
      body: m.body,
      createdAt: m.created_at,
    }));
  });

export const sendTicketMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticketId: string; body: string }) => {
    if (!input?.ticketId) throw new Error("ticketId required");
    if (!input.body?.trim()) throw new Error("Message is empty");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_send_support_message", {
      _ticket_id: data.ticketId,
      _body: data.body.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getTicketContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<TicketContact> => {
    await requireStaff(context.supabase, context.userId);
    const db = context.supabase;
    const uid = data.userId;

    const empty: TicketContact = {
      role: "unknown",
      name: null,
      phone: null,
      email: null,
      joinedAt: null,
      language: null,
      deletedAt: null,
      address: null,
      coinBalance: 0,
      stats: { bookings: 0, completed: 0, cancelled: 0, spend: 0 },
      bookings: [],
    };

    const { data: user } = await db
      .from("users")
      .select(
        "id, full_name, phone, email, created_at, preferred_language, deleted_at, total_coins_earned",
      )
      .eq("id", uid)
      .maybeSingle();

    if (user) {
      const u = user as {
        full_name: string | null;
        phone: string | null;
        email: string | null;
        created_at: string | null;
        preferred_language: string | null;
        deleted_at: string | null;
        total_coins_earned: number | null;
      };

      const [addrRes, bookRes, walletRes] = await Promise.all([
        db
          .from("addresses")
          .select("full_address, area, city, is_default")
          .eq("user_id", uid)
          .order("is_default", { ascending: false })
          .limit(1),
        db
          .from("bookings")
          .select("id, created_at, service_label, price, status")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(25),
        db.from("wallet_transactions").select("amount").eq("user_id", uid).limit(500),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookings = (bookRes.data ?? []) as any[];
      const completed = bookings.filter((b) => b.status === "completed").length;
      const cancelled = bookings.filter((b) => String(b.status).includes("cancel")).length;
      const spend = bookings
        .filter((b) => b.status === "completed")
        .reduce((s, b) => s + Number(b.price ?? 0), 0);
      const coins = ((walletRes.data ?? []) as Array<{ amount: number | null }>).reduce(
        (s, w) => s + Number(w.amount ?? 0),
        0,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addr = (addrRes.data ?? [])[0] as any;

      return {
        role: "customer",
        name: u.full_name,
        phone: u.phone,
        email: u.email,
        joinedAt: u.created_at,
        language: u.preferred_language,
        deletedAt: u.deleted_at,
        address: addr
          ? [addr.full_address, addr.area, addr.city].filter(Boolean).join(", ")
          : null,
        coinBalance: coins || Number(u.total_coins_earned ?? 0),
        stats: { bookings: bookings.length, completed, cancelled, spend },
        bookings: bookings.map((b) => ({
          id: b.id,
          createdAt: b.created_at ?? null,
          serviceLabel: b.service_label ?? null,
          price: Number(b.price ?? 0),
          status: b.status,
        })),
      };
    }

    const { data: expert } = await db
      .from("experts")
      .select("id, name, phone, created_at, preferred_language, address")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (expert) {
      const e = expert as {
        id: string;
        name: string | null;
        phone: string | null;
        created_at: string | null;
        preferred_language: string | null;
        address: string | null;
      };
      const { data: jobs } = await db
        .from("bookings")
        .select("id, created_at, service_label, price, status")
        .eq("assigned_expert_id", e.id)
        .order("created_at", { ascending: false })
        .limit(25);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (jobs ?? []) as any[];
      return {
        ...empty,
        role: "expert",
        name: e.name,
        phone: e.phone,
        email: null,
        joinedAt: e.created_at,
        language: e.preferred_language,
        address: e.address,
        stats: {
          bookings: rows.length,
          completed: rows.filter((b) => b.status === "completed").length,
          cancelled: rows.filter((b) => String(b.status).includes("cancel")).length,
          spend: rows
            .filter((b) => b.status === "completed")
            .reduce((s, b) => s + Number(b.price ?? 0), 0),
        },
        bookings: rows.map((b) => ({
          id: b.id,
          createdAt: b.created_at ?? null,
          serviceLabel: b.service_label ?? null,
          price: Number(b.price ?? 0),
          status: b.status,
        })),
      };
    }

    const { data: merchant } = await db
      .from("merchants")
      .select("id, store_name, owner_name, phone, created_at, address")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (merchant) {
      const m = merchant as {
        store_name: string | null;
        owner_name: string | null;
        phone: string | null;
        created_at: string | null;
        address: string | null;
      };
      return {
        ...empty,
        role: "merchant",
        name: m.owner_name ?? m.store_name,
        phone: m.phone,
        email: null,
        joinedAt: m.created_at,
        address: m.address,
      };
    }

    return empty;
  });

export const updateSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      ticketId: string;
      status: TicketStatus;
      note?: string | null;
      resolution?: string | null;
      resolutionOutcome?: string | null;
    }) => {
      if (!input?.ticketId) throw new Error("ticketId required");
      if (!["open", "in_progress", "answered", "resolved"].includes(input.status))
        throw new Error("Invalid status");
      if (
        input.resolutionOutcome &&
        !["expert_fault", "customer_fault", "platform_issue", "no_fault", "other"].includes(
          input.resolutionOutcome,
        )
      )
        throw new Error("Invalid resolution outcome");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase as any).rpc("staff_update_support_ticket", {
      _ticket_id: data.ticketId,
      _status: data.status,
      _note: data.note?.trim() ? data.note.trim() : undefined,
      _resolution: data.resolution?.trim() ? data.resolution.trim() : undefined,
      _resolution_outcome: data.resolutionOutcome || undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
