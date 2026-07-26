import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ExpertLevel = "bronze" | "silver" | "gold" | "diamond";
export type KycStatus = "pending" | "approved" | "rejected";
export type ActiveStatus = "active" | "inactive";

export type ExpertRow = {
  id: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  zoneId: string | null;
  zoneName: string | null;
  level: ExpertLevel;
  kycStatus: KycStatus;
  walletBalance: number;
  status: ActiveStatus;
  isOnline: boolean;
  isBusy: boolean;
};

export type ExpertDetails = ExpertRow & {
  address: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankAccountHolderName: string | null;
  kycAadhaarPath: string | null;
  kycPanPath: string | null;
  kycAddressProofPath: string | null;
  kycRejectionReason: string | null;
  securityDepositStatus: "pending" | "collected" | "adjusted";
  createdAt: string;
};

async function requireStaff(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
) {
  const { data: staff, error } = await supabase
    .from("staff_users")
    .select("role, status, zone_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!staff || staff.status !== "active") throw new Error("Forbidden");
  return staff as { role: "super_admin" | "ops_manager" | "area_partner"; status: string; zone_id: string | null };
}

export const listExperts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      zoneId?: string | null;
      kycStatus?: string | null;
      level?: string | null;
      onlineOnly?: boolean | null;
    } | undefined) => input ?? {},
  )
  .handler(async ({ data, context }): Promise<ExpertRow[]> => {
    const staff = await requireStaff(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = context.supabase
      .from("experts")
      .select(
        "id, name, phone, photo_url, zone_id, level, kyc_status, wallet_balance, status, is_online, is_busy, location_updated_at",
      );
    if (data.onlineOnly) {
      q = q.eq("is_online", true).order("is_busy", { ascending: true });
    }
    q = q.order("created_at", { ascending: false });

    if (staff.role === "area_partner") {
      if (!staff.zone_id) return [];
      q = q.eq("zone_id", staff.zone_id);
    } else if (data.zoneId) {
      q = q.eq("zone_id", data.zoneId);
    }
    if (data.kycStatus && ["pending", "approved", "rejected"].includes(data.kycStatus)) {
      q = q.eq("kyc_status", data.kycStatus);
    }
    if (data.level && ["bronze", "silver", "gold", "diamond"].includes(data.level)) {
      q = q.eq("level", data.level);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];
    const zoneIds = Array.from(new Set(raw.map((r) => r.zone_id).filter(Boolean)));
    const zoneMap = new Map<string, string>();
    if (zoneIds.length) {
      const { data: zones } = await context.supabase
        .from("zones")
        .select("id, name")
        .in("id", zoneIds);
      for (const z of (zones ?? []) as { id: string; name: string }[]) {
        zoneMap.set(z.id, z.name);
      }
    }
    return raw.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      photoUrl: r.photo_url ?? null,
      zoneId: r.zone_id ?? null,
      zoneName: r.zone_id ? zoneMap.get(r.zone_id) ?? null : null,
      level: r.level as ExpertLevel,
      kycStatus: r.kyc_status as KycStatus,
      walletBalance: r.wallet_balance != null ? Number(r.wallet_balance) : 0,
      status: r.status as ActiveStatus,
      isOnline: !!r.is_online,
      isBusy: !!r.is_busy,
    }));
  });

export const getExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id required");
    return input;
  })
  .handler(async ({ data, context }): Promise<ExpertDetails> => {
    const staff = await requireStaff(context.supabase, context.userId);
    const { data: e, error } = await context.supabase
      .from("experts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!e) throw new Error("Expert not found");
    if (staff.role === "area_partner" && (!staff.zone_id || e.zone_id !== staff.zone_id)) {
      throw new Error("Forbidden");
    }
    let zoneName: string | null = null;
    if (e.zone_id) {
      const { data: z } = await context.supabase
        .from("zones")
        .select("name")
        .eq("id", e.zone_id)
        .maybeSingle();
      zoneName = z?.name ?? null;
    }
    return {
      id: e.id,
      name: e.name,
      phone: e.phone,
      photoUrl: e.photo_url ?? null,
      zoneId: e.zone_id ?? null,
      zoneName,
      level: e.level as ExpertLevel,
      kycStatus: e.kyc_status as KycStatus,
      walletBalance: e.wallet_balance != null ? Number(e.wallet_balance) : 0,
      status: e.status as ActiveStatus,
      address: e.address ?? null,
      bankAccountNumber: e.bank_account_number ?? null,
      bankIfsc: e.bank_ifsc ?? null,
      bankAccountHolderName: e.bank_account_holder_name ?? null,
      kycAadhaarPath: e.kyc_aadhaar_url ?? null,
      kycPanPath: e.kyc_pan_url ?? null,
      kycAddressProofPath: e.kyc_address_proof_url ?? null,
      kycRejectionReason: e.kyc_rejection_reason ?? null,
      securityDepositStatus: e.security_deposit_status as ExpertDetails["securityDepositStatus"],
      createdAt: e.created_at,
    };
  });

export type UpsertExpertInput = {
  id?: string | null;
  name: string;
  phone: string;
  address?: string | null;
  zone_id?: string | null;
  level: ExpertLevel;
  status: ActiveStatus;
  photo_url?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  bank_account_holder_name?: string | null;
  kyc_aadhaar_url?: string | null;
  kyc_pan_url?: string | null;
  kyc_address_proof_url?: string | null;
};

export const upsertExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpsertExpertInput) => {
    if (!input?.name?.trim()) throw new Error("Name required");
    if (!input?.phone?.trim()) throw new Error("Phone required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("staff_upsert_expert", {
      _payload: data,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const kycDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { expertId: string; decision: KycStatus; reason?: string | null }) => {
      if (!input?.expertId) throw new Error("expertId required");
      if (!["pending", "approved", "rejected"].includes(input.decision))
        throw new Error("Invalid decision");
      if (input.decision === "rejected" && !input.reason?.trim())
        throw new Error("Reason required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_expert_kyc_decision", {
      _expert_id: data.expertId,
      _decision: data.decision,
      _reason: data.reason ?? "",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const signStorageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bucket: string; path: string }) => {
    if (!input?.bucket || !input?.path) throw new Error("bucket and path required");
    if (!["expert-kyc-docs", "expert-photos"].includes(input.bucket))
      throw new Error("Invalid bucket");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaff(context.supabase, context.userId);
    const { data: signed, error } = await context.supabase.storage
      .from(data.bucket)
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
