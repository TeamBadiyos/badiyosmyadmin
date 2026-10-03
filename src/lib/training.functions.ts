import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TRAINING_API = "https://user.badiyos.com/api/public/training";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
export type TrainingRole = "super_admin" | "ops_manager" | "area_partner";

async function staffRole(db: Db, userId: string): Promise<TrainingRole> {
  const { data } = await db
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active") throw new Error("You don't have access to this.");
  return data.role as TrainingRole;
}

export type TrainingAddress = {
  full_address: string;
  area: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type TrainingOrder = {
  id: string;
  status: string;
  serviceLabel: string | null;
  scheduledDate: string | null;
  scheduledTimeSlot: string | null;
  slotType: string | null;
  createdAt: string;
  expertId: string | null;
  expertName: string | null;
  startOtp: string | null;
  endOtp: string | null;
};

/** Turn any backend error text into a short, readable sentence. */
function friendly(raw: string, status?: number): string {
  const msg = (raw || "").trim();
  if (/MODE_MISMATCH/i.test(msg))
    return "This expert's mode doesn't match. Only experts in Training mode can get training orders.";
  if (status === 401 || /not signed in|unauthor|jwt/i.test(msg))
    return "Your session has expired. Please sign in again.";
  if (status === 403 || /forbidden|permission|not allowed|only super/i.test(msg))
    return "You don't have permission to do this.";
  if (!msg) return "Something went wrong. Please try again.";
  if (msg.length > 160 || /[{}]|sql|relation|column|function/i.test(msg))
    return "Something went wrong. Please try again.";
  return msg;
}

async function callTraining(path: string, body: unknown): Promise<unknown> {
  const auth = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
  if (!auth) throw new Error("Your session has expired. Please sign in again.");
  let res: Response;
  try {
    res = await fetch(`${TRAINING_API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the training service. Check your connection and try again.");
  }
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok || (json && typeof json === "object" && "error" in json && json.error)) {
    const raw = json?.error ? String(json.error?.message ?? json.error) : text;
    throw new Error(friendly(raw, res.status));
  }
  return json;
}

export const getTrainingSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as Db;
    const role = await staffRole(db, context.userId);
    const [addrRes, optRes, expRes] = await Promise.all([
      db.from("ops_settings").select("value").eq("key", "training_address").maybeSingle(),
      db
        .from("service_price_options")
        .select("id, label, is_active, services(name)")
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
      db.from("experts").select("id, name, phone").eq("mode", "TRAINING").order("name"),
    ]);
    let address: TrainingAddress = {
      full_address: "",
      area: null,
      city: null,
      pincode: null,
      latitude: null,
      longitude: null,
    };
    let v = addrRes.data?.value;
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        v = { full_address: v };
      }
    }
    if (v && typeof v === "object") {
      address = {
        full_address: String(v.full_address ?? ""),
        area: v.area ?? null,
        city: v.city ?? null,
        pincode: v.pincode ?? null,
        latitude: Number.isFinite(Number(v.latitude)) && v.latitude != null ? Number(v.latitude) : null,
        longitude: Number.isFinite(Number(v.longitude)) && v.longitude != null ? Number(v.longitude) : null,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = ((optRes.data ?? []) as any[]).map((o) => ({
      id: o.id as string,
      label: `${o.services?.name ? `${o.services.name} · ` : ""}${o.label}`,
    }));
    const experts = ((expRes.data ?? []) as { id: string; name: string; phone: string | null }[]).map(
      (e) => ({ id: e.id, name: e.name, phone: e.phone }),
    );
    return { role, address, options, experts };
  });

export const listTrainingOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TrainingOrder[]> => {
    const db = context.supabase as Db;
    const role = await staffRole(db, context.userId);
    if (role !== "super_admin" && role !== "ops_manager") throw new Error("You don't have access to this.");
    const { data, error } = await db
      .from("bookings")
      .select(
        "id, status, service_label, scheduled_date, scheduled_time_slot, slot_type, created_at, assigned_expert_id, start_otp, end_otp",
      )
      .eq("is_training", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("Couldn't load training orders.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const ids = Array.from(new Set(rows.map((r) => r.assigned_expert_id).filter(Boolean)));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: ex } = await db.from("experts").select("id, name").in("id", ids);
      for (const e of (ex ?? []) as { id: string; name: string }[]) names.set(e.id, e.name);
    }
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      serviceLabel: r.service_label ?? null,
      scheduledDate: r.scheduled_date ?? null,
      scheduledTimeSlot: r.scheduled_time_slot ?? null,
      slotType: r.slot_type ?? null,
      createdAt: r.created_at,
      expertId: r.assigned_expert_id ?? null,
      expertName: r.assigned_expert_id ? names.get(r.assigned_expert_id) ?? "Expert" : null,
      startOtp: r.start_otp ?? null,
      endOtp: r.end_otp ?? null,
    }));
  });

export const createTrainingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      priceOptionId: string;
      scheduledDate: string | null;
      scheduledTimeSlot: string | null;
      address: TrainingAddress;
      expertId: string | null;
    }) => {
      if (!input?.priceOptionId) throw new Error("Please choose a service.");
      if (!input.address?.full_address?.trim()) throw new Error("Please enter the address.");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const res = (await callTraining("create-booking", {
      price_option_id: data.priceOptionId,
      scheduled_date: data.scheduledDate || undefined,
      scheduled_time_slot: data.scheduledTimeSlot || undefined,
      address: data.address,
      expert_id: data.expertId || undefined,
    })) as { booking?: unknown } | null;
    const b = (res?.booking ?? res) as Record<string, unknown> | null;
    const id =
      (b && typeof b === "object" && (b["id"] ?? b["booking_id"])) ||
      (typeof b === "string" ? b : null);
    return { bookingId: id ? String(id) : null };
  });

export const deleteTrainingOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { ids?: string[]; from?: string | null; to?: string | null; expertId?: string | null }) =>
      input ?? {},
  )
  .handler(async ({ data }) => {
    const body: Record<string, unknown> = {};
    if (data.ids?.length) body["booking_ids"] = data.ids;
    else {
      if (data.from) body["from"] = data.from;
      if (data.to) body["to"] = data.to;
      if (data.expertId) body["expert_id"] = data.expertId;
    }
    const res = await callTraining("delete-bookings", body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = res as any;
    const n =
      typeof r === "number"
        ? r
        : Number(r?.deleted ?? r?.count ?? r?.deleted_count ?? (Array.isArray(r) ? r.length : NaN));
    return { deleted: Number.isFinite(n) ? n : null };
  });

export const setExpertMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { expertId: string; mode: "TRAINING" | "LIVE" }) => {
    if (!input?.expertId || (input.mode !== "TRAINING" && input.mode !== "LIVE"))
      throw new Error("Invalid request.");
    return input;
  })
  .handler(async ({ data }) => {
    await callTraining("set-expert-mode", { expert_id: data.expertId, mode: data.mode });
    return { ok: true };
  });

export const saveTrainingAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: TrainingAddress) => {
    if (!input?.full_address?.trim()) throw new Error("Please enter the address.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as Db;
    const role = await staffRole(db, context.userId);
    if (role !== "super_admin") throw new Error("Only a super admin can change the training address.");
    const { error } = await db.rpc("staff_set_ops_setting", {
      _key: "training_address",
      _value: JSON.stringify(data),
    });
    if (error) throw new Error(friendly(error.message));
    return { ok: true };
  });
