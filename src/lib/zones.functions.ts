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

    return (data ?? []).map((z) => ({
      id: z.id as string,
      name: z.name as string,
      city: z.city as string,
      status: z.status as "active" | "inactive",
      assignedAreaPartnerId: (z.assigned_area_partner_id as string | null) ?? null,
      assignedAreaPartnerName: null,
    }));
  });
