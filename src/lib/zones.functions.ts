import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ZoneRow = {
  id: string;
  name: string;
  city: string;
  status: "active" | "inactive";
  assignedAreaPartnerId: string | null;
  assignedAreaPartnerName: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
};

export const listZones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { includeDeleted?: boolean } | null) => ({
    includeDeleted: !!input?.includeDeleted,
  }))
  .handler(async ({ data, context }): Promise<ZoneRow[]> => {
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("role, status, zone_id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    // Only super_admin may view soft-deleted zones.
    const includeDeleted = data.includeDeleted && staff.role === "super_admin";

    let query = context.supabase
      .from("zones")
      .select("id, name, city, status, assigned_area_partner_id, deleted_at, delete_reason")
      .order("created_at", { ascending: false });

    if (!includeDeleted) query = query.is("deleted_at", null);

    if (staff.role === "area_partner") {
      if (!staff.zone_id) return [];
      query = query.eq("id", staff.zone_id);
    }

    const { data: rows_, error } = await query;
    if (error) throw new Error(error.message);
    const rows = rows_ ?? [];

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
      deletedAt: (z.deleted_at as string | null) ?? null,
      deleteReason: (z.delete_reason as string | null) ?? null,
    }));
  });

// NOTE: boundary polygons are intentionally not editable here. A separate
// "Redraw Boundary" action can be added later if needed.
export const updateZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { zoneId: string; name: string; city: string; status: "active" | "inactive" }) => {
    if (!input?.zoneId) throw new Error("zoneId required");
    const name = input.name?.trim();
    const city = input.city?.trim();
    if (!name) throw new Error("Zone name is required");
    if (!city) throw new Error("City is required");
    if (input.status !== "active" && input.status !== "inactive") {
      throw new Error("Invalid status");
    }
    return { zoneId: input.zoneId, name, city, status: input.status };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_zone", {
      _zone_id: data.zoneId,
      _payload: { name: data.name, city: data.city, status: data.status },
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type ZoneDeleteImpact = {
  activeExperts: number;
  hasPartner: boolean;
  openBookings: number;
};

export const getZoneDeleteImpact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { zoneId: string }) => {
    if (!input?.zoneId) throw new Error("zoneId required");
    return { zoneId: input.zoneId };
  })
  .handler(async ({ data, context }): Promise<ZoneDeleteImpact> => {
    const { data: res, error } = await context.supabase.rpc("zone_delete_impact", {
      _zone_id: data.zoneId,
    });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (res ?? {}) as any;
    return {
      activeExperts: Number(r.active_experts ?? 0),
      hasPartner: !!r.has_partner,
      openBookings: Number(r.open_bookings ?? 0),
    };
  });

export const deleteZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { zoneId: string; reason: string }) => {
    if (!input?.zoneId) throw new Error("zoneId required");
    const reason = input.reason?.trim();
    if (!reason) throw new Error("A reason is required");
    return { zoneId: input.zoneId, reason };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_soft_delete_zone", {
      _zone_id: data.zoneId,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
export type LatLng = { lat: number; lng: number };

export const getZoneBoundary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { zoneId: string }) => {
    if (!input?.zoneId) throw new Error("zoneId required");
    return { zoneId: input.zoneId };
  })
  .handler(async ({ data, context }): Promise<LatLng[]> => {
    const { data: row, error } = await context.supabase
      .from("zones")
      .select("boundary")
      .eq("id", data.zoneId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (row?.boundary ?? []) as any[];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  });

export const redrawZoneBoundary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { zoneId: string; boundary: LatLng[] }) => {
    if (!input?.zoneId) throw new Error("zoneId required");
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
    return { zoneId: input.zoneId, boundary };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_redraw_zone_boundary", {
      _zone_id: data.zoneId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _boundary: data.boundary as any,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });



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

export type AreaPartner = { id: string; name: string; phone: string };

export const listAreaPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AreaPartner[]> => {
    const { data: staff } = await context.supabase
      .from("staff_users")
      .select("status")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!staff || staff.status !== "active") throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("area_partners")
      .select("id, name, phone")
      .eq("status", "active")
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AreaPartner[];
  });

export const assignAreaPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { zoneId: string; partnerId: string | null }) => {
    if (!input?.zoneId) throw new Error("zoneId required");
    return {
      zoneId: input.zoneId,
      partnerId: input.partnerId ? input.partnerId : null,
    };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_assign_area_partner", {
      _zone_id: data.zoneId,
      _partner_id: data.partnerId as string,
    });

    if (error) throw new Error(error.message);
    return { ok: true as const };
  });


