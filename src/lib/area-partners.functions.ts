import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PartnerKycStatus = "pending" | "approved" | "rejected";

export type AreaPartnerRow = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  zoneId: string | null;
  zoneName: string | null;
  setupFeeStatus: "pending" | "paid";
  commissionRate: number;
  kycStatus: PartnerKycStatus;
  status: "active" | "inactive";
  deletedAt: string | null;
  deleteReason: string | null;
};

export type AreaPartnerDetails = AreaPartnerRow & {
  address: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankAccountHolderName: string | null;
  kycAadhaarPath: string | null;
  kycPanPath: string | null;
  kycAddressProofPath: string | null;
  kycRejectionReason: string | null;
  createdAt: string;
};

type StaffRow = {
  role: "super_admin" | "ops_manager" | "area_partner";
  status: string;
  zone_id: string | null;
};

async function requireAdminStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<StaffRow> {
  const { data: staff, error } = await supabase
    .from("staff_users")
    .select("role, status, zone_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!staff || staff.status !== "active") throw new Error("Forbidden");
  if (!["super_admin", "ops_manager"].includes(staff.role)) throw new Error("Forbidden");
  return staff as StaffRow;
}

const PARTNER_COLUMNS =
  "id, name, phone, photo_url, zone_id, setup_fee_status, commission_rate, kyc_status, status, deleted_at, delete_reason, created_at";

export const listAllAreaPartners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { includeDeleted?: boolean } | null) => ({
    includeDeleted: !!input?.includeDeleted,
  }))
  .handler(async ({ data, context }): Promise<AreaPartnerRow[]> => {
    const staff = await requireAdminStaff(context.supabase, context.userId);
    const includeDeleted = data.includeDeleted && staff.role === "super_admin";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = context.supabase
      .from("area_partners")
      .select(PARTNER_COLUMNS)
      .order("created_at", { ascending: false });
    if (!includeDeleted) query = query.is("deleted_at", null);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];

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
        photoUrl: r.photo_url ?? null,
        zoneId: assigned?.id ?? r.zone_id ?? null,
        zoneName: assigned?.name ?? null,
        setupFeeStatus: r.setup_fee_status,
        commissionRate: r.commission_rate != null ? Number(r.commission_rate) : 0,
        kycStatus: (r.kyc_status ?? "pending") as PartnerKycStatus,
        status: r.status,
        deletedAt: r.deleted_at ?? null,
        deleteReason: r.delete_reason ?? null,
      };
    });
  });

export const getAreaPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return { id: input.id };
  })
  .handler(async ({ data, context }): Promise<AreaPartnerDetails> => {
    await requireAdminStaff(context.supabase, context.userId);
    const { data: p, error } = await context.supabase
      .from("area_partners")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Area partner not found");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = p as any;

    let zoneId: string | null = r.zone_id ?? null;
    let zoneName: string | null = null;
    const { data: z } = await context.supabase
      .from("zones")
      .select("id, name")
      .eq("assigned_area_partner_id", data.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (z) {
      zoneId = (z as { id: string }).id;
      zoneName = (z as { name: string }).name;
    }

    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      photoUrl: r.photo_url ?? null,
      zoneId,
      zoneName,
      setupFeeStatus: r.setup_fee_status,
      commissionRate: r.commission_rate != null ? Number(r.commission_rate) : 0,
      kycStatus: (r.kyc_status ?? "pending") as PartnerKycStatus,
      status: r.status,
      deletedAt: r.deleted_at ?? null,
      deleteReason: r.delete_reason ?? null,
      address: r.address ?? null,
      bankAccountNumber: r.bank_account_number ?? null,
      bankIfsc: r.bank_ifsc ?? null,
      bankAccountHolderName: r.bank_account_holder_name ?? null,
      kycAadhaarPath: r.kyc_aadhaar_url ?? null,
      kycPanPath: r.kyc_pan_url ?? null,
      kycAddressProofPath: r.kyc_address_proof_url ?? null,
      kycRejectionReason: r.kyc_rejection_reason ?? null,
      createdAt: r.created_at,
    };
  });

export type UpsertAreaPartnerInput = {
  id?: string | null;
  name: string;
  phone: string;
  setup_fee_status: "pending" | "paid";
  commission_rate: number;
  status: "active" | "inactive";
  address?: string | null;
  photo_url?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  bank_account_holder_name?: string | null;
  kyc_aadhaar_url?: string | null;
  kyc_pan_url?: string | null;
  kyc_address_proof_url?: string | null;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { _payload: data as any },
    );
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const areaPartnerKycDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { partnerId: string; decision: PartnerKycStatus; reason?: string | null }) => {
      if (!input?.partnerId) throw new Error("partnerId required");
      if (!["pending", "approved", "rejected"].includes(input.decision))
        throw new Error("Invalid decision");
      if (input.decision === "rejected" && !input.reason?.trim())
        throw new Error("Reason required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase.rpc as any)(
      "staff_area_partner_kyc_decision",
      {
        _partner_id: data.partnerId,
        _decision: data.decision,
        _reason: data.reason ?? "",
      },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteAreaPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { partnerId: string; reason: string }) => {
    if (!input?.partnerId) throw new Error("partnerId required");
    const reason = input.reason?.trim();
    if (!reason) throw new Error("A reason is required");
    return { partnerId: input.partnerId, reason };
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (context.supabase.rpc as any)(
      "staff_soft_delete_area_partner",
      { _partner_id: data.partnerId, _reason: data.reason },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const signPartnerStorageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bucket: string; path: string }) => {
    if (!input?.bucket || !input?.path) throw new Error("bucket and path required");
    if (!["area-partner-kyc-docs", "area-partner-photos"].includes(input.bucket))
      throw new Error("Invalid bucket");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireAdminStaff(context.supabase, context.userId);
    const { data: signed, error } = await context.supabase.storage
      .from(data.bucket)
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
