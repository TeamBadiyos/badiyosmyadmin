import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) {
    throw new Error("Forbidden");
  }
  return data.role as "super_admin" | "ops_manager";
}

export type CustomerRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  area: string | null;
  city: string | null;
  created_at: string | null;
  preferred_language: string | null;
  referral_code: string | null;
  successful_referrals: number;
  total_coins_earned: number;
  bookings_count: number;
  total_spend: number;
  deleted_at: string | null;
};

export type CustomerProfile = {
  user: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    created_at: string | null;
    preferred_language: string | null;
    referral_code: string | null;
    referred_by: string | null;
    referral_count: number;
    successful_referrals: number;
    total_coins_earned: number;
    deleted_at: string | null;
  };
  stats: {
    bookings: number;
    completed: number;
    cancelled: number;
    lifetime_spend: number;
    avg_rating: number | null;
    coin_balance: number;
  };
  addresses: Array<{
    id: string;
    label: string | null;
    full_address: string;
    area: string | null;
    city: string | null;
    is_default: boolean | null;
  }>;
  bookings: Array<{
    id: string;
    created_at: string | null;
    scheduled_date: string | null;
    scheduled_time_slot: string | null;
    service_label: string | null;
    price: number;
    status: string;
    expert_name: string | null;
    paid: boolean;
    rating: number | null;
  }>;
  wallet: Array<{
    id: string;
    amount: number;
    type: string;
    description: string;
    created_at: string;
  }>;
  referrals: Array<{
    id: string;
    direction: "made" | "received";
    counterpart_name: string | null;
    counterpart_phone: string | null;
    status: string;
    reward_amount: number;
    created_at: string | null;
  }>;
  tickets: Array<{
    id: string;
    message: string;
    status: string;
    source: string;
    created_at: string;
  }>;
  deletionRequests: Array<{
    id: string;
    status: string;
    reason: string | null;
    created_at: string;
  }>;
};

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input:
        | {
            search?: string | null;
            page?: number;
            pageSize?: number;
            includeDeleted?: boolean;
            sort?: "recent" | "spend";
          }
        | undefined,
    ) => input ?? {},
  )
  .handler(async ({ data, context }): Promise<{ rows: CustomerRow[]; total: number }> => {
    await requireStaff(context.supabase, context.userId);
    const db = context.supabase;
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, data.pageSize ?? 25));
    const search = (data.search ?? "").trim();

    let q = db
      .from("users")
      .select(
        "id, full_name, phone, email, created_at, preferred_language, referral_code, successful_referrals, total_coins_earned, deleted_at",
        { count: "exact" },
      );
    if (!data.includeDeleted) q = q.is("deleted_at", null);
    if (search) {
      const esc = search.replace(/[%,]/g, "");
      q = q.or(`full_name.ilike.%${esc}%,phone.ilike.%${esc}%,email.ilike.%${esc}%`);
    }
    q = q
      .order("created_at", { ascending: false, nullsFirst: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    const { data: users, error, count } = await q;
    if (error) throw new Error(error.message);
    const ids = (users ?? []).map((u: { id: string }) => u.id);

    const [bookingsRes, addressRes] = await Promise.all([
      ids.length
        ? db.from("bookings").select("user_id, price, status").in("user_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? db
            .from("addresses")
            .select("user_id, area, city, is_default")
            .in("user_id", ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (bookingsRes.error) throw new Error(bookingsRes.error.message);
    if (addressRes.error) throw new Error(addressRes.error.message);

    const agg = new Map<string, { count: number; spend: number }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of (bookingsRes.data ?? []) as any[]) {
      const cur = agg.get(b.user_id) ?? { count: 0, spend: 0 };
      cur.count += 1;
      if (b.status === "completed") cur.spend += Number(b.price ?? 0);
      agg.set(b.user_id, cur);
    }
    const addr = new Map<string, { area: string | null; city: string | null }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of (addressRes.data ?? []) as any[]) {
      if (!addr.has(a.user_id) || a.is_default)
        addr.set(a.user_id, { area: a.area ?? null, city: a.city ?? null });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: CustomerRow[] = ((users ?? []) as any[]).map((u) => ({
      id: u.id,
      full_name: u.full_name ?? null,
      phone: u.phone ?? null,
      email: u.email ?? null,
      area: addr.get(u.id)?.area ?? null,
      city: addr.get(u.id)?.city ?? null,
      created_at: u.created_at ?? null,
      preferred_language: u.preferred_language ?? null,
      referral_code: u.referral_code ?? null,
      successful_referrals: Number(u.successful_referrals ?? 0),
      total_coins_earned: Number(u.total_coins_earned ?? 0),
      bookings_count: agg.get(u.id)?.count ?? 0,
      total_spend: agg.get(u.id)?.spend ?? 0,
      deleted_at: u.deleted_at ?? null,
    }));

    if (data.sort === "spend") rows.sort((a, b) => b.total_spend - a.total_spend);

    return { rows, total: count ?? rows.length };
  });

export const getCustomerProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("userId required");
    return input;
  })
  .handler(async ({ data, context }): Promise<CustomerProfile> => {
    await requireStaff(context.supabase, context.userId);
    const db = context.supabase;
    const uid = data.userId;

    const { data: user, error: uErr } = await db
      .from("users")
      .select(
        "id, full_name, phone, email, avatar_url, created_at, preferred_language, referral_code, referred_by, referral_count, successful_referrals, total_coins_earned, deleted_at",
      )
      .eq("id", uid)
      .maybeSingle();
    if (uErr) throw new Error(uErr.message);
    if (!user) throw new Error("Customer not found");

    const [addrRes, bookRes, walletRes, refRes, ticketRes] = await Promise.all([
      db
        .from("addresses")
        .select("id, label, full_address, area, city, is_default")
        .eq("user_id", uid)
        .order("is_default", { ascending: false }),
      db
        .from("bookings")
        .select(
          "id, created_at, scheduled_date, scheduled_time_slot, service_label, price, status, rating, razorpay_payment_id, assigned_expert_id",
        )
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("wallet_transactions")
        .select("id, amount, type, description, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("referral_transactions")
        .select("id, status, reward_amount, created_at, referrer_id, referred_user_id")
        .or(`referrer_id.eq.${uid},referred_user_id.eq.${uid}`)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("support_tickets")
        .select("id, message, status, source, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (addrRes.error) throw new Error(addrRes.error.message);
    if (bookRes.error) throw new Error(bookRes.error.message);
    if (walletRes.error) throw new Error(walletRes.error.message);
    if (refRes.error) throw new Error(refRes.error.message);
    if (ticketRes.error) throw new Error(ticketRes.error.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bookingRows = (bookRes.data ?? []) as any[];
    const expertIds = Array.from(
      new Set(bookingRows.map((b) => b.assigned_expert_id).filter(Boolean)),
    ) as string[];
    const counterpartIds = Array.from(
      new Set(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((refRes.data ?? []) as any[])
          .map((r) => (r.referrer_id === uid ? r.referred_user_id : r.referrer_id))
          .filter(Boolean),
      ),
    ) as string[];

    const [expertsRes, peopleRes, delRes] = await Promise.all([
      expertIds.length
        ? db.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [], error: null }),
      counterpartIds.length
        ? db.from("users").select("id, full_name, phone").in("id", counterpartIds)
        : Promise.resolve({ data: [], error: null }),
      user.phone
        ? db
            .from("account_deletion_requests")
            .select("id, status, reason, created_at")
            .eq("phone", user.phone)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (expertsRes.error) throw new Error(expertsRes.error.message);
    if (peopleRes.error) throw new Error(peopleRes.error.message);
    if (delRes.error) throw new Error(delRes.error.message);

    const expertMap = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of (expertsRes.data ?? []) as any[]) expertMap.set(e.id, e.name);
    const peopleMap = new Map<string, { name: string | null; phone: string | null }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (peopleRes.data ?? []) as any[])
      peopleMap.set(p.id, { name: p.full_name ?? null, phone: p.phone ?? null });

    const completed = bookingRows.filter((b) => b.status === "completed");
    const cancelled = bookingRows.filter((b) => b.status === "cancelled" || b.status === "rejected");
    const ratings = bookingRows.map((b) => b.rating).filter((r) => typeof r === "number");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walletRows = (walletRes.data ?? []) as any[];
    const coinBalance = walletRows.reduce(
      (sum, w) => sum + (w.type === "debit" ? -Number(w.amount ?? 0) : Number(w.amount ?? 0)),
      0,
    );

    return {
      user: {
        id: user.id,
        full_name: user.full_name ?? null,
        phone: user.phone ?? null,
        email: user.email ?? null,
        avatar_url: user.avatar_url ?? null,
        created_at: user.created_at ?? null,
        preferred_language: user.preferred_language ?? null,
        referral_code: user.referral_code ?? null,
        referred_by: user.referred_by ?? null,
        referral_count: Number(user.referral_count ?? 0),
        successful_referrals: Number(user.successful_referrals ?? 0),
        total_coins_earned: Number(user.total_coins_earned ?? 0),
        deleted_at: user.deleted_at ?? null,
      },
      stats: {
        bookings: bookingRows.length,
        completed: completed.length,
        cancelled: cancelled.length,
        lifetime_spend: completed.reduce((s, b) => s + Number(b.price ?? 0), 0),
        avg_rating: ratings.length
          ? ratings.reduce((s: number, r: number) => s + r, 0) / ratings.length
          : null,
        coin_balance: coinBalance,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addresses: ((addrRes.data ?? []) as any[]).map((a) => ({
        id: a.id,
        label: a.label ?? null,
        full_address: a.full_address,
        area: a.area ?? null,
        city: a.city ?? null,
        is_default: a.is_default ?? null,
      })),
      bookings: bookingRows.map((b) => ({
        id: b.id,
        created_at: b.created_at ?? null,
        scheduled_date: b.scheduled_date ?? null,
        scheduled_time_slot: b.scheduled_time_slot ?? null,
        service_label: b.service_label ?? null,
        price: Number(b.price ?? 0),
        status: b.status,
        expert_name: b.assigned_expert_id ? (expertMap.get(b.assigned_expert_id) ?? null) : null,
        paid: Boolean(b.razorpay_payment_id),
        rating: typeof b.rating === "number" ? b.rating : null,
      })),
      wallet: walletRows.map((w) => ({
        id: w.id,
        amount: Number(w.amount ?? 0),
        type: w.type,
        description: w.description,
        created_at: w.created_at,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      referrals: ((refRes.data ?? []) as any[]).map((r) => {
        const counterId = r.referrer_id === uid ? r.referred_user_id : r.referrer_id;
        const person = counterId ? peopleMap.get(counterId) : null;
        return {
          id: r.id,
          direction: (r.referrer_id === uid ? "made" : "received") as "made" | "received",
          counterpart_name: person?.name ?? null,
          counterpart_phone: person?.phone ?? null,
          status: r.status,
          reward_amount: Number(r.reward_amount ?? 0),
          created_at: r.created_at ?? null,
        };
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tickets: ((ticketRes.data ?? []) as any[]).map((t) => ({
        id: t.id,
        message: t.message,
        status: t.status,
        source: t.source,
        created_at: t.created_at,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deletionRequests: ((delRes.data ?? []) as any[]).map((d) => ({
        id: d.id,
        status: d.status,
        reason: d.reason ?? null,
        created_at: d.created_at,
      })),
    };
  });
