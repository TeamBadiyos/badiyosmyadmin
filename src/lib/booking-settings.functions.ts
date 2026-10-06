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
  "asap_onway_deadline_minutes",
  "scheduled_onway_deadline_before_slot_minutes",
  "expert_reminder_before_slot_minutes",
  "no_expert_alert_before_slot_minutes",
  "no_expert_refund_after_slot_minutes",
  "expert_journey_steps_enabled",
  "service_extensions_enabled",
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
  asap_onway_deadline_minutes: "3",
  scheduled_onway_deadline_before_slot_minutes: "15",
  expert_reminder_before_slot_minutes: "30",
  no_expert_alert_before_slot_minutes: "5",
  no_expert_refund_after_slot_minutes: "30",
  expert_journey_steps_enabled: "0",
  service_extensions_enabled: "1",
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
      if (key === "expert_journey_steps_enabled" || key === "service_extensions_enabled") {
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
