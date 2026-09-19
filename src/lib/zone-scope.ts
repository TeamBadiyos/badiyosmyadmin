export type StaffRoleName = "super_admin" | "ops_manager" | "area_partner";

export type StaffScope = {
  role: StaffRoleName;
  staffId: string;
  /** Every zone this staff member covers (multi-zone aware). */
  zoneIds: string[];
  /** Primary zone, kept for display/back-compat. */
  zoneId: string | null;
};

/**
 * Loads the signed-in staff member and the full set of zones they cover.
 * Falls back to the legacy single `zone_id` column when no link rows exist.
 */
export async function loadStaffScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<StaffScope> {
  const { data: staff, error } = await supabase
    .from("staff_users")
    .select("id, role, status, zone_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!staff || staff.status !== "active") throw new Error("Forbidden");

  const { data: links } = await supabase
    .from("staff_user_zones")
    .select("zone_id")
    .eq("staff_user_id", staff.id);

  const linked = ((links ?? []) as { zone_id: string }[]).map((r) => r.zone_id);
  const zoneIds = linked.length
    ? Array.from(new Set(linked))
    : staff.zone_id
      ? [staff.zone_id as string]
      : [];

  return {
    role: staff.role as StaffRoleName,
    staffId: staff.id as string,
    zoneIds,
    zoneId: (staff.zone_id as string | null) ?? zoneIds[0] ?? null,
  };
}
