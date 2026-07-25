import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BookingStatus =
  | "confirmed"
  | "accepted"
  | "assigned"
  | "expert_assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "rejected";

export const BOOKING_STATUSES: BookingStatus[] = [
  "confirmed",
  "accepted",
  "assigned",
  "expert_assigned",
  "in_progress",
  "completed",
  "cancelled",
  "rejected",
];

export type BookingRow = {
  id: string;
  customerName: string;
  serviceLabel: string | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  zoneId: string | null;
  zoneName: string | null;
  assignedExpertId: string | null;
  assignedExpertName: string | null;
  status: BookingStatus;
  paid: boolean;
  createdAt: string;
};

export type ListBookingsInput = {
  status?: string | null;
  zoneId?: string | null;
  from?: string | null; // ISO date (yyyy-mm-dd)
  to?: string | null;
  page?: number;
  pageSize?: number;
};

export type ListBookingsResult = {
  rows: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
};

const sel = (s: string): string => s;

export const listBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ListBookingsInput | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<ListBookingsResult> => {
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    const page = Math.max(1, Math.floor(data.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Math.floor(data.pageSize ?? 25)));
    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = context.supabase
      .from("bookings")
      .select(
        sel(
          "id, service_label, scheduled_date, scheduled_time_slot, status, razorpay_payment_id, created_at, zone_id, assigned_expert_id, user_id",
        ),
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(fromIdx, toIdx);

    if (staff.role === "area_partner") {
      if (!staff.zone_id) {
        return { rows: [], total: 0, page, pageSize };
      }
      q = q.eq("zone_id", staff.zone_id);
    } else if (data.zoneId) {
      q = q.eq("zone_id", data.zoneId);
    }

    if (data.status && BOOKING_STATUSES.includes(data.status as BookingStatus)) {
      q = q.eq("status", data.status);
    }
    if (data.from) q = q.gte("created_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("created_at", `${data.to}T23:59:59Z`);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];
    const userIds = Array.from(new Set(raw.map((r) => r.user_id).filter(Boolean)));
    const zoneIds = Array.from(new Set(raw.map((r) => r.zone_id).filter(Boolean)));
    const expertIds = Array.from(
      new Set(raw.map((r) => r.assigned_expert_id).filter(Boolean)),
    );

    const [usersRes, zonesRes, expertsRes] = await Promise.all([
      userIds.length
        ? context.supabase.from("users").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      zoneIds.length
        ? context.supabase.from("zones").select("id, name").in("id", zoneIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      expertIds.length
        ? context.supabase.from("experts").select("id, name").in("id", expertIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

    const userMap = new Map(
      ((usersRes.data ?? []) as { id: string; full_name: string | null }[]).map(
        (u) => [u.id, u.full_name ?? "—"],
      ),
    );
    const zoneMap = new Map(
      ((zonesRes.data ?? []) as { id: string; name: string }[]).map((z) => [
        z.id,
        z.name,
      ]),
    );
    const expertMap = new Map(
      ((expertsRes.data ?? []) as { id: string; name: string }[]).map((e) => [
        e.id,
        e.name,
      ]),
    );

    const out: BookingRow[] = raw.map((r) => ({
      id: r.id,
      customerName: userMap.get(r.user_id) ?? "—",
      serviceLabel: r.service_label ?? null,
      scheduledDate: r.scheduled_date ?? null,
      scheduledTimeSlot: r.scheduled_time_slot ?? null,
      zoneId: r.zone_id ?? null,
      zoneName: r.zone_id ? zoneMap.get(r.zone_id) ?? null : null,
      assignedExpertId: r.assigned_expert_id ?? null,
      assignedExpertName: r.assigned_expert_id
        ? expertMap.get(r.assigned_expert_id) ?? null
        : null,
      status: r.status as BookingStatus,
      paid: !!r.razorpay_payment_id,
      createdAt: r.created_at,
    }));

    return { rows: out, total: count ?? out.length, page, pageSize };
  });

export type ZoneOption = { id: string; name: string };

export const listZoneOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZoneOption[]> => {
    const { data: staff } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = context.supabase
      .from("zones")
      .select("id, name")
      .eq("status", "active")
      .order("name");
    if (staff.role === "area_partner") {
      if (!staff.zone_id) return [];
      q = q.eq("id", staff.zone_id);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as ZoneOption[]);
  });
