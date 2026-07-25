import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AreaPartnerRow = {
  id: string;
  name: string;
  phone: string;
  zoneId: string | null;
  zoneName: string | null;
  setupFeeStatus: "pending" | "paid";
  commissionRate: number;
  status: "active" | "inactive";
};

async function requireAdminStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const { data: staff, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!staff || staff.status !== "active") throw new Error("Forbidden");
  if (!["super_admin", "ops_manager"].includes(staff.role)) throw new Error("Forbidden");
  return staff;
}

export const listAllAreaPartners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AreaPartnerRow[]> => {
    await requireAdminStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("area_partners")
      .select("id, name, phone, zone_id, setup_fee_status, commission_rate, status, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (data ?? []) as any[];

    // Zones assigned via zones.assigned_area_partner_id (source of truth on Zones page)
    const partnerIds = raw.map((r) => r.id);
    const zoneByPartner = new Map<string, { id: string; name: string }>();
    if (partnerIds.length) {
      const { data: zones } = await context.supabase
        .from("zones")
        .select("id, name, assigned_area_partner_id")
        .in("assigned_area_partner_id", partnerIds);
      for (const z of (zones ?? []) as {
        id: string;
        name: string;
        assigned_area_partner_id: string;
      }[]) {
        zoneByPartner.set(z.assigned_area_partner_id, { id: z.id, name: z.name });
      }
    }

    return raw.map((r) => {
      const assigned = zoneByPartner.get(r.id) ?? null;
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        zoneId: assigned?.id ?? r.zone_id ?? null,
        zoneName: assigned?.name ?? null,
        setupFeeStatus: r.setup_fee_status,
        commissionRate: r.commission_rate != null ? Number(r.commission_rate) : 0,
        status: r.status,
      };
    });
  });

export type UpsertAreaPartnerInput = {
  id?: string | null;
  name: string;
  phone: string;
  setup_fee_status: "pending" | "paid";
  commission_rate: number;
  status: "active" | "inactive";
};

export const upsertAreaPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertAreaPartnerInput) => {
    if (!input?.name?.trim()) throw new Error("Name required");
    if (!input?.phone?.trim()) throw new Error("Phone required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc(
      "staff_upsert_area_partner",
      { _payload: data },
    );
    if (error) throw new Error(error.message);
    return { id: id as string };
  });
