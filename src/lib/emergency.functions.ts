import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EmergencyAlert = {
  id: string;
  expertId: string;
  expertName: string | null;
  expertPhone: string | null;
  bookingId: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  notes: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
};

async function assertActiveStaff(context: {
  supabase: { from: (t: string) => any };
  userId: string;
}) {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("id, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "active") throw new Error("Forbidden");
}

export const listEmergencyAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmergencyAlert[]> => {
    await assertActiveStaff(context);
    const db = context.supabase;

    const { data, error } = await db
      .from("emergency_alerts")
      .select(
        "id, expert_id, booking_id, latitude, longitude, status, notes, created_at, acknowledged_at, acknowledged_by",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (rows.length === 0) return [];

    const expertIds = Array.from(new Set(rows.map((r) => r.expert_id).filter(Boolean)));
    const ackIds = Array.from(
      new Set(rows.map((r) => r.acknowledged_by).filter(Boolean)),
    );

    const [expertsRes, staffRes] = await Promise.all([
      expertIds.length
        ? db.from("experts").select("id, name, phone").in("id", expertIds)
        : Promise.resolve({ data: [], error: null } as const),
      ackIds.length
        ? db.from("staff_users").select("auth_user_id, name").in("auth_user_id", ackIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if ("error" in expertsRes && expertsRes.error) throw expertsRes.error;
    if ("error" in staffRes && staffRes.error) throw staffRes.error;

    const expertMap = new Map(
      ((expertsRes.data ?? []) as any[]).map((e) => [e.id, e]),
    );
    const staffMap = new Map(
      ((staffRes.data ?? []) as any[]).map((s) => [s.auth_user_id, s.name as string]),
    );

    return rows.map((r) => {
      const e = expertMap.get(r.expert_id);
      return {
        id: r.id as string,
        expertId: r.expert_id as string,
        expertName: (e?.name as string | undefined) ?? null,
        expertPhone: (e?.phone as string | undefined) ?? null,
        bookingId: (r.booking_id as string | null) ?? null,
        latitude: r.latitude === null ? null : Number(r.latitude),
        longitude: r.longitude === null ? null : Number(r.longitude),
        status: (r.status as string) ?? "open",
        notes: (r.notes as string | null) ?? null,
        createdAt: r.created_at as string,
        acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
        acknowledgedByName: r.acknowledged_by
          ? (staffMap.get(r.acknowledged_by) ?? null)
          : null,
      };
    });
  });

export const acknowledgeEmergencyAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { alertId: string; notes?: string | null }) => {
    if (!data?.alertId) throw new Error("alertId is required");
    return { alertId: data.alertId, notes: data.notes ?? null };
  })
  .handler(async ({ context, data }) => {
    await assertActiveStaff(context);
    const { error } = await context.supabase.rpc(
      "staff_acknowledge_emergency_alert",
      { _alert_id: data.alertId, _notes: data.notes },
    );
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });
