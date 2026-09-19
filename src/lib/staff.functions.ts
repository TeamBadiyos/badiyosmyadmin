import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StaffRole = "super_admin" | "ops_manager" | "area_partner";
export type StaffStatus = "active" | "inactive";

export type StaffUserRow = {
  id: string;
  authUserId: string;
  name: string;
  email: string;
  role: StaffRole;
  zoneId: string | null;
  zoneName: string | null;
  zoneIds: string[];
  zoneNames: string[];
  status: StaffStatus;
  createdAt: string;
  isSelf: boolean;
};


// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireSuperAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || data.role !== "super_admin") {
    throw new Error("Forbidden");
  }
}

export const listStaffUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffUserRow[]> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("staff_users")
      .select("id, auth_user_id, name, email, role, zone_id, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];

    const { data: links } = await context.supabase
      .from("staff_user_zones")
      .select("staff_user_id, zone_id")
      .in(
        "staff_user_id",
        rows.map((r) => r.id),
      );
    const linkRows = (links ?? []) as { staff_user_id: string; zone_id: string }[];
    const zonesByStaff = new Map<string, string[]>();
    for (const l of linkRows) {
      const list = zonesByStaff.get(l.staff_user_id) ?? [];
      list.push(l.zone_id);
      zonesByStaff.set(l.staff_user_id, list);
    }

    const zoneIds = Array.from(
      new Set([
        ...rows.map((r) => r.zone_id).filter((v): v is string => !!v),
        ...linkRows.map((l) => l.zone_id),
      ]),
    );
    const zoneNameById = new Map<string, string>();
    if (zoneIds.length) {
      const { data: zones } = await context.supabase
        .from("zones")
        .select("id, name")
        .in("id", zoneIds);
      for (const z of (zones ?? []) as { id: string; name: string }[]) {
        zoneNameById.set(z.id, z.name);
      }
    }

    return rows.map((r) => {
      const ids = zonesByStaff.get(r.id) ?? (r.zone_id ? [r.zone_id] : []);
      const names = ids.map((id) => zoneNameById.get(id) ?? "—").sort();
      return {
        id: r.id,
        authUserId: r.auth_user_id,
        name: r.name,
        email: r.email,
        role: r.role,
        zoneId: r.zone_id ?? ids[0] ?? null,
        zoneName: r.zone_id ? zoneNameById.get(r.zone_id) ?? null : names[0] ?? null,
        zoneIds: ids,
        zoneNames: names,
        status: r.status,
        createdAt: r.created_at,
        isSelf: r.auth_user_id === context.userId,
      };
    });

  });

export type CreateStaffUserInput = {
  name: string;
  email: string;
  role: "ops_manager" | "area_partner";
  zone_id?: string | null;
  zone_ids?: string[] | null;
  password: string;
};

function normalizeZoneIds(
  role: StaffRole,
  zoneIds: string[] | null | undefined,
  zoneId: string | null | undefined,
): string[] {
  if (role !== "area_partner") return [];
  const ids = (zoneIds && zoneIds.length ? zoneIds : zoneId ? [zoneId] : []).filter(Boolean);
  return Array.from(new Set(ids));
}

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateStaffUserInput) => {
    const name = (input?.name ?? "").trim();
    const email = (input?.email ?? "").trim().toLowerCase();
    const password = input?.password ?? "";
    if (!name) throw new Error("Name required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Valid email required");
    if (!["ops_manager", "area_partner"].includes(input?.role))
      throw new Error("Invalid role");
    const zone_ids = normalizeZoneIds(input?.role, input?.zone_ids, input?.zone_id);
    if (input.role === "area_partner" && zone_ids.length === 0)
      throw new Error("At least one zone is required for an area partner");
    return { ...input, name, email, zone_ids, zone_id: zone_ids[0] ?? null };
  })

  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message ?? "Failed to create auth user");
    }
    const authUserId = created.user.id;

    const insertPayload = {
      auth_user_id: authUserId,
      name: data.name,
      email: data.email,
      role: data.role,
      zone_id: data.role === "area_partner" ? data.zone_id : null,
      status: "active" as const,
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("staff_users")
      .insert(insertPayload)
      .select("id, auth_user_id, name, email, role, zone_id, status, created_at")
      .single();

    if (insertErr) {
      // Rollback the auth user so we don't leave an orphan
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
      throw new Error(insertErr.message);
    }

    if (data.zone_ids.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: zErr } = await (context.supabase.rpc as any)(
        "staff_set_staff_user_zones",
        { _staff_user_id: inserted.id, _zone_ids: data.zone_ids },
      );
      if (zErr) throw new Error(zErr.message);
    }

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "create_staff_user",
      target_table: "staff_users",
      target_id: inserted.id,
      before_state: null,
      after_state: { ...inserted, zone_ids: data.zone_ids },
    });

    return { id: inserted.id as string };
  });

export type UpdateStaffUserInput = {
  id: string;
  role: StaffRole;
  zone_id?: string | null;
  zone_ids?: string[] | null;
  status: StaffStatus;
};

export const updateStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateStaffUserInput) => {
    if (!input?.id) throw new Error("id required");
    if (!["super_admin", "ops_manager", "area_partner"].includes(input?.role))
      throw new Error("Invalid role");
    if (!["active", "inactive"].includes(input?.status)) throw new Error("Invalid status");
    const zone_ids = normalizeZoneIds(input.role, input.zone_ids, input.zone_id);
    if (input.role === "area_partner" && zone_ids.length === 0)
      throw new Error("At least one zone is required for an area partner");
    return { ...input, zone_ids, zone_id: zone_ids[0] ?? null };
  })

  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("staff_users")
      .select("id, auth_user_id, name, email, role, zone_id, status, created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("Staff user not found");

    // Prevent self-deactivation
    if (
      before.auth_user_id === context.userId &&
      before.status === "active" &&
      data.status === "inactive"
    ) {
      throw new Error("You cannot deactivate your own account");
    }
    // Prevent changing your own role (safety)
    if (before.auth_user_id === context.userId && before.role !== data.role) {
      throw new Error("You cannot change your own role");
    }

    const patch = {
      role: data.role,
      zone_id: data.role === "area_partner" ? data.zone_id : null,
      status: data.status,
    };

    const { data: after, error: updErr } = await supabaseAdmin
      .from("staff_users")
      .update(patch)
      .eq("id", data.id)
      .select("id, auth_user_id, name, email, role, zone_id, status, created_at")
      .single();
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "update_staff_user",
      target_table: "staff_users",
      target_id: after.id,
      before_state: before,
      after_state: after,
    });

    return { ok: true };
  });
