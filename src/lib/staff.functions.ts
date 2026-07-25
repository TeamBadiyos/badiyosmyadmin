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

    const zoneIds = Array.from(
      new Set(rows.map((r) => r.zone_id).filter((v): v is string => !!v)),
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

    return rows.map((r) => ({
      id: r.id,
      authUserId: r.auth_user_id,
      name: r.name,
      email: r.email,
      role: r.role,
      zoneId: r.zone_id,
      zoneName: r.zone_id ? zoneNameById.get(r.zone_id) ?? null : null,
      status: r.status,
      createdAt: r.created_at,
      isSelf: r.auth_user_id === context.userId,
    }));
  });

export type CreateStaffUserInput = {
  name: string;
  email: string;
  role: "ops_manager" | "area_partner";
  zone_id?: string | null;
  password: string;
};

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
    if (input.role === "area_partner" && !input.zone_id)
      throw new Error("Zone required for area partner");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    return { ...input, name, email, zone_id: input.zone_id ?? null };
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

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "create_staff_user",
      target_table: "staff_users",
      target_id: inserted.id,
      before_state: null,
      after_state: inserted,
    });

    return { id: inserted.id as string };
  });

export type UpdateStaffUserInput = {
  id: string;
  role: StaffRole;
  zone_id?: string | null;
  status: StaffStatus;
};

export const updateStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateStaffUserInput) => {
    if (!input?.id) throw new Error("id required");
    if (!["super_admin", "ops_manager", "area_partner"].includes(input?.role))
      throw new Error("Invalid role");
    if (!["active", "inactive"].includes(input?.status)) throw new Error("Invalid status");
    if (input.role === "area_partner" && !input.zone_id)
      throw new Error("Zone required for area partner");
    return input;
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
