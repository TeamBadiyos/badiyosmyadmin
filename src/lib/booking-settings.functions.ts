import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
};

async function staffRole(context: Ctx): Promise<"super_admin" | "ops_manager"> {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  if (data.role !== "super_admin" && data.role !== "ops_manager") throw new Error("Forbidden");
  return data.role;
}

/** ops_settings keys that drive booking dispatch timing + the journey-steps switch. */
export const BOOKING_TIMING_KEYS = [
  "booking_dispatch_lead_minutes",
  "booking_buffer_minutes",
  "slot_first_start_hour",
  "slot_last_start_hour",
  "slot_step_minutes",
  "asap_onway_deadline_minutes",
  "scheduled_onway_deadline_before_slot_minutes",
  "expert_reminder_before_slot_minutes",
  "no_expert_alert_before_slot_minutes",
  "no_expert_refund_after_slot_minutes",
  "expert_journey_steps_enabled",
  "service_extensions_enabled",
  "instant_booking_enabled",
] as const;

export type BookingTimingKey = (typeof BOOKING_TIMING_KEYS)[number];

export type BookingTimingSettings = {
  canEdit: boolean;
  values: Record<BookingTimingKey, string>;
  updatedAt: Record<string, string | null>;
};

const DEFAULTS: Record<BookingTimingKey, string> = {
  booking_dispatch_lead_minutes: "60",
  booking_buffer_minutes: "5",
  slot_first_start_hour: "10",
  slot_last_start_hour: "18",
  slot_step_minutes: "30",
  asap_onway_deadline_minutes: "3",
  scheduled_onway_deadline_before_slot_minutes: "15",
  expert_reminder_before_slot_minutes: "30",
  no_expert_alert_before_slot_minutes: "5",
  no_expert_refund_after_slot_minutes: "30",
  expert_journey_steps_enabled: "0",
  service_extensions_enabled: "1",
  instant_booking_enabled: "1",
};

export const getBookingTimingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BookingTimingSettings> => {
    const role = await staffRole(context as Ctx);
    const { data, error } = await (context as Ctx).supabase
      .from("ops_settings")
      .select("key, value, updated_at")
      .in("key", BOOKING_TIMING_KEYS as unknown as string[]);
    if (error) throw new Error(error.message);

    const values = { ...DEFAULTS };
    const updatedAt: Record<string, string | null> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (data ?? []) as any[]) {
      const key = row.key as BookingTimingKey;
      if (key in values) values[key] = String(row.value ?? "");
      updatedAt[key] = (row.updated_at as string | null) ?? null;
    }
    return { canEdit: role === "super_admin", values, updatedAt };
  });

/** Bounds keep an accidental edit from breaking dispatch. */
const NUMERIC_BOUNDS: Partial<Record<BookingTimingKey, [number, number]>> = {
  booking_dispatch_lead_minutes: [0, 720],
  booking_buffer_minutes: [0, 120],
  slot_first_start_hour: [0, 23],
  slot_last_start_hour: [0, 23],
  slot_step_minutes: [30, 60],
  asap_onway_deadline_minutes: [1, 120],
  scheduled_onway_deadline_before_slot_minutes: [0, 240],
  expert_reminder_before_slot_minutes: [0, 240],
  no_expert_alert_before_slot_minutes: [0, 240],
  no_expert_refund_after_slot_minutes: [0, 240],
};

export const saveBookingTimingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { values: Partial<Record<BookingTimingKey, string>> }) => {
    const entries = Object.entries(input?.values ?? {}) as Array<[BookingTimingKey, string]>;
    if (entries.length === 0) throw new Error("Nothing to save");
    for (const [key, raw] of entries) {
      if (!(BOOKING_TIMING_KEYS as readonly string[]).includes(key)) {
        throw new Error(`Unknown setting: ${key}`);
      }
      if (key === "expert_journey_steps_enabled" || key === "service_extensions_enabled" || key === "instant_booking_enabled") {
        if (raw !== "0" && raw !== "1") throw new Error("Journey steps switch must be on or off");
        continue;
      }
      const num = Number(raw);
      if (!Number.isFinite(num) || !Number.isInteger(num)) {
        throw new Error(`${key.replace(/_/g, " ")} must be a whole number`);
      }
      const bounds = NUMERIC_BOUNDS[key];
      if (bounds && (num < bounds[0] || num > bounds[1])) {
        throw new Error(
          `${key.replace(/_/g, " ")} must be between ${bounds[0]} and ${bounds[1]}`,
        );
      }
    }
    return { values: Object.fromEntries(entries) as Record<BookingTimingKey, string> };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const role = await staffRole(context as Ctx);
    if (role !== "super_admin") {
      throw new Error("Only a super admin can change booking timing settings");
    }

    const first = Number(data.values["slot_first_start_hour"]);
    const last = Number(data.values["slot_last_start_hour"]);
    if (Number.isFinite(first) && Number.isFinite(last) && first > last) {
      throw new Error("First slot hour cannot be after the last slot hour");
    }

    // staff_set_ops_setting is super-admin gated and writes its own audit_logs row.
    for (const [key, value] of Object.entries(data.values)) {
      const { error } = await (context as Ctx).supabase.rpc("staff_set_ops_setting", {
        _key: key,
        _value: value,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listSlotOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "")) throw new Error("Invalid date");
    return i;
  })
  .handler(async ({ data, context }) => {
    const role = await staffRole(context as Ctx);
    const sb = (context as Ctx).supabase;
    const [ov, bk, cfg] = await Promise.all([
      sb.from("service_slot_overrides").select("start_hour, start_minute, reason").eq("service_key", "clean").eq("slot_date", data.date).eq("status", "fully_booked"),
      sb.from("bookings").select("scheduled_time_slot, status").eq("scheduled_date", data.date).neq("slot_type", "now"),
      sb.from("ops_settings").select("key, value").in("key", ["slot_first_start_hour", "slot_last_start_hour", "slot_step_minutes", "instant_booking_enabled"]),
    ]);
    if (ov.error) throw new Error(ov.error.message);
    const c: Record<string, string> = {};
    for (const r of (cfg.data ?? []) as Array<{ key: string; value: string }>) c[r.key] = r.value;
    const counts: Record<number, number> = {};
    for (const b of (bk.data ?? []) as Array<{ scheduled_time_slot: string | null; status: string }>) {
      if (["cancelled", "refunded", "rejected"].includes(b.status)) continue;
      const m = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])/.exec(b.scheduled_time_slot ?? "");
      if (!m) continue;
      let h = Number(m[1]); const ap = m[3]!.toUpperCase();
      if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0;
      const k = h * 60 + Math.floor(Number(m[2] ?? 0) / 30) * 30;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return {
      canEdit: role === "super_admin" || role === "ops_manager",
      first: Number(c["slot_first_start_hour"] ?? 10),
      last: Number(c["slot_last_start_hour"] ?? 18),
      step: Number(c["slot_step_minutes"] ?? 30) === 60 ? 60 : 30,
      instantOn: (c["instant_booking_enabled"] ?? "1") !== "0",
      full: ((ov.data ?? []) as Array<{ start_hour: number; start_minute: number | null; reason: string | null }>).map((f) => ({ ...f, key: f.start_hour * 60 + (f.start_minute ?? 0) })),
      counts,
    };
  });

export const setSlotFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string; hour: number; minute?: number; full: boolean; reason?: string }) => i)
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await ((context as Ctx).supabase.rpc as any)("staff_set_slot_full", {
      _date: data.date, _start_hour: data.hour, _full: data.full, _reason: data.reason ?? null, _start_minute: data.minute === 30 ? 30 : 0,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setInstantBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { on: boolean }) => i)
  .handler(async ({ data, context }) => {
    const { error } = await (context as Ctx).supabase.rpc("staff_set_ops_setting", {
      _key: "instant_booking_enabled", _value: data.on ? "1" : "0",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSlotCapacity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "")) throw new Error("Invalid date");
    return i;
  })
  .handler(async ({ data, context }) => {
    const sb = (context as Ctx).supabase;
    const [cfg, day, cap, busy] = await Promise.all([
      sb.from("ops_settings").select("key, value").in("key", ["slot_capacity_enabled", "default_slot_capacity", "slot_capacity_mode"]),
      sb.from("service_daily_capacity").select("capacity").eq("service_key", "clean").eq("cap_date", data.date).maybeSingle(),
      sb.rpc("slot_capacity_for", { _service_key: "clean", _date: data.date }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sb.rpc as any)("slot_busy_by_half", { _service_key: "clean", _date: data.date }),
    ]);
    if (cap.error) throw new Error(cap.error.message);
    if (busy.error) throw new Error(busy.error.message);
    const c: Record<string, string> = {};
    for (const r of (cfg.data ?? []) as Array<{ key: string; value: string }>) c[r.key] = r.value;
    const busyMap: Record<number, number> = {};
    for (const r of (busy.data ?? []) as Array<{ start_min: number; busy: number }>) busyMap[r.start_min] = r.busy;
    return {
      enabled: c["slot_capacity_enabled"] === "1",
      mode: (c["slot_capacity_mode"] === "live" ? "live" : "manual") as "live" | "manual",
      defaultCap: Number(c["default_slot_capacity"] ?? 5),
      dayCap: (day.data as { capacity: number } | null)?.capacity ?? null,
      capacity: Number(cap.data ?? 0),
      busy: busyMap,
    };
  });

export const setDailyCapacity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string; capacity: number | null }) => i)
  .handler(async ({ data, context }) => {
    const { error } = await (context as Ctx).supabase.rpc("staff_set_daily_capacity", { _date: data.date, _capacity: data.capacity });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setCapacitySetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { key: "slot_capacity_enabled" | "default_slot_capacity" | "slot_capacity_mode"; value: string }) => {
    if (i.key === "slot_capacity_enabled" && !["0", "1"].includes(i.value)) throw new Error("Invalid");
    if (i.key === "slot_capacity_mode" && !["manual", "live"].includes(i.value)) throw new Error("Invalid");
    if (i.key === "default_slot_capacity") { const n = Number(i.value); if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error("Maid count must be 0–500"); }
    return i;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context as Ctx).supabase.rpc("staff_set_ops_setting", { _key: data.key, _value: data.value });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
