import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ZoneRow = {
  id: string;
  name: string;
  city: string;
  status: "active" | "inactive";
  assignedAreaPartnerId: string | null;
  assignedAreaPartnerName: string | null;
};

export const listZones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZoneRow[]> => {
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    let query = context.supabase
      .from("zones")
      .select("id, name, city, status, assigned_area_partner_id")
      .order("created_at", { ascending: false });

    if (staff.role === "area_partner") {
      if (!staff.zone_id) return [];
      query = query.eq("id", staff.zone_id);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = data ?? [];

    const partnerIds = Array.from(
      new Set(
        rows
          .map((z) => z.assigned_area_partner_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );
    const partnerMap = new Map<string, string>();
    if (partnerIds.length) {
      const { data: partners } = await context.supabase
        .from("area_partners")
        .select("id, name")
        .in("id", partnerIds);
      for (const p of partners ?? []) {
        partnerMap.set(p.id as string, p.name as string);
      }
    }

    return rows.map((z) => ({
      id: z.id as string,
      name: z.name as string,
      city: z.city as string,
      status: z.status as "active" | "inactive",
      assignedAreaPartnerId: (z.assigned_area_partner_id as string | null) ?? null,
      assignedAreaPartnerName:
        (z.assigned_area_partner_id &&
          partnerMap.get(z.assigned_area_partner_id as string)) ||
        null,
    }));
  });


export type LatLng = { lat: number; lng: number };

export const createZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { name: string; city: string; boundary: LatLng[] }) => {
      const name = input?.name?.trim();
      const city = input?.city?.trim();
      if (!name) throw new Error("Zone name is required");
      if (!city) throw new Error("City is required");
      if (!Array.isArray(input?.boundary) || input.boundary.length < 3) {
        throw new Error("Zone boundary must have at least 3 points");
      }
      const boundary = input.boundary.map((p) => {
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error("Invalid boundary point");
        }
        return { lat, lng };
      });
      return { name, city, boundary };
    },
  )
  .handler(async ({ data, context }) => {
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("role, status")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staff || staff.status !== "active") throw new Error("Forbidden");
    if (staff.role !== "super_admin" && staff.role !== "ops_manager") {
      throw new Error("Forbidden");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("zones")
      .insert({
        name: data.name,
        city: data.city,
        boundary: data.boundary,
      })
      .select("id, name, city, boundary, status")
      .single();
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "create_zone",
      target_table: "zones",
      target_id: inserted.id,
      before_state: null,
      after_state: inserted,
    });

    return { id: inserted.id as string };
  });

