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


/** Keys stored per city in city_ops_settings (no shared copy). */
const CITY_KEYS = new Set(["slot_capacity_enabled", "slot_capacity_mode", "default_slot_capacity", "wash_default_slot_capacity",
  "clean_band_morning_end", "clean_band_day_end", "wash_band_morning_end", "wash_band_day_end",
  "slot_first_start_hour", "slot_last_start_hour", "slot_step_minutes", "instant_booking_enabled", "wash_instant_booking_enabled",
  "clean_auto_cancel_minutes", "wash_auto_cancel_minutes", "clean_last_slot_before_close_minutes", "wash_last_slot_before_close_minutes",
  "clean_cancel_fee_percent", "wash_cancel_fee_percent", "clean_no_refund_after_arrived", "wash_no_refund_after_arrived", "clean_cancel_policy", "wash_cancel_policy", "store_cancel_policy", "food_cancel_policy"]);

/** City-wise keys come only from the city's own row; other keys from shared ops_settings. */
async function readOps(sb: any, keys: string[], cityId?: string | null): Promise<Record<string, string>> {
  const c: Record<string, string> = {};
  const shared = keys.filter((k) => !CITY_KEYS.has(k));
  const base = shared.length ? await sb.from("ops_settings").select("key, value").in("key", shared) : { data: [] };
  for (const r of (base.data ?? []) as Array<{ key: string; value: string }>) c[r.key] = String(r.value);
  if (cityId && cityId !== "all") {
    const cr = await sb.from("city_ops_settings").select("key, value").eq("city_id", cityId).in("key", keys);
    for (const r of (cr.data ?? []) as Array<{ key: string; value: string }>) c[r.key] = String(r.value);
  }
  return c;
}
async function writeOps(sb: any, key: string, value: string, cityId?: string | null) {
  if (!cityId || cityId === "all") throw new Error("Pick a city to edit");
  const { error } = await sb.rpc("staff_set_city_ops", { _city_id: cityId, _values: { [key]: value } });
  if (error) throw new Error(error.message);
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
  .inputValidator((i: { cityId?: string | null } | undefined) => ({ cityId: i?.cityId ?? null }))
  .handler(async ({ data: inp, context }): Promise<BookingTimingSettings> => {
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
    if (inp.cityId && inp.cityId !== "all") {
      const cr = await (context as Ctx).supabase.from("city_ops_settings").select("key, value, updated_at").eq("city_id", inp.cityId)
        .in("key", (BOOKING_TIMING_KEYS as readonly string[]).filter((k) => CITY_KEYS.has(k)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of (cr.data ?? []) as any[]) { values[row.key as BookingTimingKey] = String(row.value ?? ""); updatedAt[row.key] = row.updated_at ?? null; }
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
  .inputValidator((input: { values: Partial<Record<BookingTimingKey, string>>; cityId?: string | null }) => {
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
    return { values: Object.fromEntries(entries) as Record<BookingTimingKey, string>, cityId: input.cityId ?? null };
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
      if (CITY_KEYS.has(key)) { await writeOps((context as Ctx).supabase, key, value, data.cityId); continue; }
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
  .inputValidator((i: { date: string; group?: "clean" | "wash"; cityId?: string | null }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "")) throw new Error("Invalid date");
    return { date: i.date, group: i.group === "wash" ? "wash" : "clean", cityId: i.cityId ?? null } as const;
  })
  .handler(async ({ data, context }) => {
    const role = await staffRole(context as Ctx);
    const sb = (context as Ctx).supabase;
    const [ov, bk, cfg] = await Promise.all([
      (() => { let q = sb.from("service_slot_overrides").select("start_hour, start_minute, reason").eq("service_key", data.group).eq("slot_date", data.date).eq("status", "fully_booked"); if (data.cityId && data.cityId !== "all") q = q.eq("city_id", data.cityId); return q; })(),
      (() => { let q = sb.from("bookings").select("scheduled_time_slot, status, service_duration_minutes, service_categories(slug)").eq("scheduled_date", data.date).neq("slot_type", "now"); if (data.cityId && data.cityId !== "all") q = q.eq("city_id", data.cityId); return q; })(),
      readOps(sb, ["slot_first_start_hour", "slot_last_start_hour", "slot_step_minutes", "instant_booking_enabled", "wash_instant_booking_enabled", "booking_buffer_minutes"], data.cityId),
    ]);
    if (ov.error) throw new Error(ov.error.message);
    const c = cfg;
    const buffer = Number(c["booking_buffer_minutes"] ?? 5);
    const counts: Record<number, number> = {};
    for (const b of (bk.data ?? []) as unknown as Array<{ scheduled_time_slot: string | null; status: string; service_duration_minutes: number | null; service_categories: { slug: string } | null }>) {
      if (["cancelled", "refunded", "rejected"].includes(b.status)) continue;
      if ((b.service_categories?.slug === "car-bike-wash") !== (data.group === "wash")) continue;
      const m = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])/.exec(b.scheduled_time_slot ?? "");
      if (!m) continue;
      let h = Number(m[1]); const ap = m[3]!.toUpperCase();
      if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0;
      const start = h * 60 + Math.floor(Number(m[2] ?? 0) / 30) * 30;
      // A booking occupies the maid/washer for its whole duration + buffer, so
      // every half-hour slot it touches counts as busy — not just the start slot.
      const span = Math.max(30, (b.service_duration_minutes ?? 30) + buffer);
      for (let k = start; k < start + span && k < 1440; k += 30) {
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    return {
      canEdit: role === "super_admin" || role === "ops_manager",
      first: Number(c["slot_first_start_hour"] ?? 10),
      last: Number(c["slot_last_start_hour"] ?? 18),
      step: Number(c["slot_step_minutes"] ?? 30) === 60 ? 60 : 30,
      instantOn: (c["instant_booking_enabled"] ?? "1") !== "0",
      washInstantOn: (c["wash_instant_booking_enabled"] ?? "1") !== "0",
      full: ((ov.data ?? []) as Array<{ start_hour: number; start_minute: number | null; reason: string | null }>).map((f) => ({ ...f, key: f.start_hour * 60 + (f.start_minute ?? 0) })),
      counts,
    };
  });

export const setSlotFull = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string; hour: number; minute?: number; full: boolean; reason?: string; group?: "clean" | "wash"; cityId?: string | null }) => {
    if (!i.cityId || i.cityId === "all") throw new Error("Pick a city to edit");
    return i;
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await ((context as Ctx).supabase.rpc as any)("staff_set_slot_full", {
      _date: data.date, _start_hour: data.hour, _full: data.full, _reason: data.reason ?? null, _service_key: data.group === "wash" ? "wash" : "clean", _start_minute: data.minute === 30 ? 30 : 0, _city_id: data.cityId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setInstantBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { on: boolean; group?: "clean" | "wash"; cityId?: string | null }) => i)
  .handler(async ({ data, context }) => {
    await writeOps((context as Ctx).supabase, data.group === "wash" ? "wash_instant_booking_enabled" : "instant_booking_enabled", data.on ? "1" : "0", data.cityId);
    return { ok: true };
  });

export type CapGroup = "clean" | "wash";
const grp = (g?: string): CapGroup => (g === "wash" ? "wash" : "clean");

export const getSlotCapacity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string; group?: CapGroup; cityId?: string | null }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "")) throw new Error("Invalid date");
    return { date: i.date, group: grp(i.group), cityId: i.cityId ?? null };
  })
  .handler(async ({ data, context }) => {
    const sb = (context as Ctx).supabase;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anySb = sb as any;
    const defKey = data.group === "wash" ? "wash_default_slot_capacity" : "default_slot_capacity";
    const [cfg, sum] = await Promise.all([
      readOps(sb, ["slot_capacity_enabled", "slot_capacity_mode", defKey, `${data.group}_band_morning_end`, `${data.group}_band_day_end`], data.cityId),
      anySb.rpc("staff_slot_band_summary", { _service_key: data.group, _date: data.date, _city_id: data.cityId && data.cityId !== "all" ? data.cityId : null }),
    ]);
    if (sum.error) throw new Error(sum.error.message);
    const c: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg)) c[k] = String(v).replace(/"/g, "");
    const s = sum.data as { bands: Band[]; default_cap: number; morning_end: number; day_end: number };
    return {
      enabled: c["slot_capacity_enabled"] === "1",
      mode: (c["slot_capacity_mode"] === "live" ? "live" : "manual") as "live" | "manual",
      defaultCap: Number(c[defKey] ?? 5),
      morningEnd: Number(c[`${data.group}_band_morning_end`] ?? s.morning_end),
      dayEnd: Number(c[`${data.group}_band_day_end`] ?? s.day_end),
      bands: s.bands,
    };
  });

export type Band = { band: "morning" | "day" | "evening"; start_min: number; end_min: number; capacity: number; booked: number; full: boolean; override: number | null };

export const setBandCapacity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { date: string; group?: CapGroup; morning: number | null; day: number | null; evening: number | null; cityId?: string | null }) => {
    if (!i.cityId || i.cityId === "all") throw new Error("Pick a city to edit");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i?.date ?? "")) throw new Error("Invalid date");
    for (const v of [i.morning, i.day, i.evening]) if (v != null && (!Number.isInteger(v) || v < 0 || v > 500)) throw new Error("Count must be 0–500");
    return { ...i, group: grp(i.group) };
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await ((context as Ctx).supabase.rpc as any)("staff_set_band_capacity", { _service_key: data.group, _date: data.date, _morning: data.morning, _day: data.day, _evening: data.evening, _city_id: data.cityId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type CapKey = "slot_capacity_enabled" | "default_slot_capacity" | "wash_default_slot_capacity" | "slot_capacity_mode"
  | "clean_band_morning_end" | "clean_band_day_end" | "wash_band_morning_end" | "wash_band_day_end";

export const setCapacitySetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { key: CapKey; value: string; cityId?: string | null }) => {
    if (i.key === "slot_capacity_enabled" && !["0", "1"].includes(i.value)) throw new Error("Invalid");
    if (i.key === "slot_capacity_mode" && !["manual", "live"].includes(i.value)) throw new Error("Invalid");
    if (i.key.endsWith("default_slot_capacity")) { const n = Number(i.value); if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error("Count must be 0–500"); }
    if (i.key.includes("_band_")) { const n = Number(i.value); if (!Number.isInteger(n) || n < 0 || n > 1440) throw new Error("Invalid time"); }
    return i;
  })
  .handler(async ({ data, context }) => {
    await writeOps((context as Ctx).supabase, data.key, data.value, data.cityId);
    return { ok: true };
  });

/** One auto-cancel window (Book Now + Scheduled), counted from search start (city_ops_settings). */
export const getAutoCancelMinutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: CapGroup; cityId?: string | null }) => ({ group: grp(i?.group), cityId: i?.cityId ?? null }))
  .handler(async ({ data, context }) => {
    const role = await staffRole(context as Ctx);
    const cid = data.cityId && data.cityId !== "all" ? data.cityId : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (context as Ctx).supabase.rpc as any;
    const key = `${data.group === "wash" ? "wash" : "clean"}_auto_cancel_minutes`;
    let minutes: number | null = null;
    if (cid) {
      const c = await readOps((context as Ctx).supabase, [key], cid);
      if (c[key] != null && c[key] !== "") minutes = Number(String(c[key]).replace(/"/g, ""));
    }
    if (minutes == null || !Number.isFinite(minutes)) {
      const { data: m, error } = await rpc("app_auto_cancel_minutes", { _service_key: data.group, _city_id: cid });
      if (error) throw new Error(error.message);
      minutes = Number(m ?? 120);
    }
    return { minutes, canEdit: role === "super_admin" || role === "ops_manager" };
  });

export const setAutoCancelMinutes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: CapGroup; minutes: number; cityId?: string | null }) => {
    const n = Number(i.minutes);
    if (!Number.isInteger(n) || n < 5 || n > 1440) throw new Error("Minutes must be 5–1440");
    return { group: grp(i.group), minutes: n, cityId: i.cityId ?? null };
  })
  .handler(async ({ data, context }) => {
    await staffRole(context as Ctx);
    const key = `${data.group === "wash" ? "wash" : "clean"}_auto_cancel_minutes`;
    await writeOps((context as Ctx).supabase, key, String(data.minutes), data.cityId);
    return { ok: true };
  });

/** Live count of experts who can take a Book Now job right now. */
export const getLiveExpertCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: CapGroup; cityId?: string | null }) => ({ group: grp(i?.group), cityId: i?.cityId ?? null }))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: r, error } = await ((context as Ctx).supabase.rpc as any)("staff_live_expert_counts", {
      _service_key: data.group, _city_id: data.cityId && data.cityId !== "all" ? data.cityId : null,
    });
    if (error) throw new Error(error.message);
    const o = (r ?? {}) as Record<string, number>;
    return { online: Number(o.online ?? 0), free: Number(o.free ?? 0), busy: Number(o.busy ?? 0), noDevice: Number(o.no_device ?? 0) };
  });

/** Active experts with no registered phone for job alerts. */
export const listExpertsWithoutDevice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await ((context as Ctx).supabase.rpc as any)("staff_experts_without_device");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string; name: string; is_online: boolean; city_id: string | null }>).map((e) => ({ id: e.id, name: e.name, online: !!e.is_online }));
  });


/** "Last slot before closing" (minutes) per city/service: last slot = closing time − this. */
export const getLastSlotGap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: CapGroup; cityId?: string | null }) => ({ group: grp(i?.group), cityId: i?.cityId ?? null }))
  .handler(async ({ data, context }) => {
    const role = await staffRole(context as Ctx);
    const key = `${data.group}_last_slot_before_close_minutes`;
    const c = await readOps((context as Ctx).supabase, [key], data.cityId);
    const raw = c[key] != null ? Number(String(c[key]).replace(/"/g, "")) : 60;
    return { minutes: Number.isFinite(raw) ? raw : 60, canEdit: role === "super_admin" || role === "ops_manager" };
  });

export const setLastSlotGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: CapGroup; minutes: number; cityId?: string | null }) => {
    const n = Number(i.minutes);
    if (!Number.isInteger(n) || n < 0 || n > 600) throw new Error("Minutes must be 0–600");
    return { group: grp(i.group), minutes: n, cityId: i.cityId ?? null };
  })
  .handler(async ({ data, context }) => {
    await staffRole(context as Ctx);
    await writeOps((context as Ctx).supabase, `${data.group}_last_slot_before_close_minutes`, String(data.minutes), data.cityId);
    return { ok: true };
  });


export type CancelPolicy = { en: string[]; mr: string[] };
export const DEFAULT_CANCEL_POLICY: CancelPolicy = {
  en: [
    "Cancel before an expert is assigned: full refund.",
    "Cancel after an expert is assigned: {fee_percent}% cancellation fee, rest refunded.",
    "Cancel after the expert arrives: no refund.",
    "If no expert accepts within {auto_cancel_minutes} minutes, the booking is cancelled automatically with a full refund.",
    "Choose your refund: instantly to your badiyos Wallet, or to your original payment method in 5–7 working days.",
  ],
  mr: [
    "मदतनीस नेमण्यापूर्वी रद्द केल्यास: पूर्ण परतावा.",
    "मदतनीस नेमल्यानंतर रद्द केल्यास: {fee_percent}% रद्द शुल्क, उर्वरित परत.",
    "मदतनीस पोहोचल्यानंतर रद्द केल्यास: परतावा नाही.",
    "{auto_cancel_minutes} मिनिटांत कोणी स्वीकारले नाही तर बुकिंग आपोआप रद्द होऊन पूर्ण परतावा.",
    "परतावा निवडा: त्वरित badiyos Wallet मध्ये, किंवा मूळ पेमेंट पद्धतीवर 5–7 कामकाजाच्या दिवसांत.",
  ],
};

export const DEFAULT_STORE_CANCEL_POLICY: CancelPolicy = {
  en: [
    "Cancel before the shop accepts your order: full refund.",
    "Once the shop accepts, the order can't be cancelled from the app — contact Help.",
    "If the shop rejects the order, no rider is found or delivery fails: full refund automatically.",
    "Refunds: instantly to your badiyos Wallet, or to your original payment method in 5–7 working days.",
  ],
  mr: [
    "दुकानाने ऑर्डर स्वीकारण्यापूर्वी रद्द केल्यास: पूर्ण परतावा.",
    "दुकानाने स्वीकारल्यानंतर ॲपमधून रद्द करता येणार नाही — Help शी संपर्क करा.",
    "दुकानाने नाकारल्यास, रायडर न मिळाल्यास किंवा डिलिव्हरी न झाल्यास: आपोआप पूर्ण परतावा.",
    "परतावा: त्वरित badiyos Wallet मध्ये, किंवा मूळ पेमेंट पद्धतीवर 5–7 कामकाजाच्या दिवसांत.",
  ],
};
export type PolicyGroup = CapGroup | "store" | "food";
const pgrp = (g?: string): PolicyGroup => (g === "store" || g === "food" ? g : grp(g));
export const defaultPolicyFor = (g: PolicyGroup) => (g === "store" || g === "food" ? DEFAULT_STORE_CANCEL_POLICY : DEFAULT_CANCEL_POLICY);

/** Cancellation rules per city/service: fee %, no-refund-after-arrived, policy text. */
export const getCancelRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: PolicyGroup; cityId?: string | null }) => ({ group: pgrp(i?.group), cityId: i?.cityId ?? null }))
  .handler(async ({ data, context }) => {
    const role = await staffRole(context as Ctx);
    const g = data.group;
    const c = await readOps((context as Ctx).supabase, [`${g}_cancel_fee_percent`, `${g}_no_refund_after_arrived`, `${g}_cancel_policy`], data.cityId);
    let policy: CancelPolicy = defaultPolicyFor(g);
    try {
      const p = JSON.parse(c[`${g}_cancel_policy`] ?? "");
      if (Array.isArray(p?.en)) policy = { en: p.en.map(String), mr: Array.isArray(p.mr) ? p.mr.map(String) : [] };
    } catch { /* default */ }
    return {
      feePercent: Number(c[`${g}_cancel_fee_percent`] ?? 50),
      noRefundAfterArrived: (c[`${g}_no_refund_after_arrived`] ?? "1") === "1",
      policy,
      canEdit: role === "super_admin" || role === "ops_manager",
    };
  });

export const saveCancelRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { group?: PolicyGroup; cityId?: string | null; feePercent?: number; noRefundAfterArrived?: boolean; policy?: CancelPolicy }) => {
    if (i.feePercent != null && (!Number.isFinite(i.feePercent) || i.feePercent < 0 || i.feePercent > 100)) throw new Error("Fee must be 0–100%");
    if (i.policy) {
      const clean = (a: unknown) => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean).slice(0, 10) : []);
      const en = clean(i.policy.en), mr = clean(i.policy.mr);
      if (!en.length) throw new Error("Add at least one English line");
      if ([...en, ...mr].some((l) => l.length > 240)) throw new Error("Each line can be at most 240 characters");
      i = { ...i, policy: { en, mr } };
    }
    return { ...i, group: pgrp(i.group), cityId: i.cityId ?? null };
  })
  .handler(async ({ data, context }) => {
    await staffRole(context as Ctx);
    const sb = (context as Ctx).supabase, g = data.group;
    if (data.feePercent != null) await writeOps(sb, `${g}_cancel_fee_percent`, String(data.feePercent), data.cityId);
    if (data.noRefundAfterArrived != null) await writeOps(sb, `${g}_no_refund_after_arrived`, data.noRefundAfterArrived ? "1" : "0", data.cityId);
    if (data.policy) await writeOps(sb, `${g}_cancel_policy`, JSON.stringify(data.policy), data.cityId);
    return { ok: true };
  });
