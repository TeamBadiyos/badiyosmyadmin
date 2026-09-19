import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadStaffScope } from "@/lib/zone-scope";

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
  zoneIds: string[];
  zoneNames: string[];
  level: ExpertLevel;
  kycStatus: KycStatus;
  walletBalance: number;
  status: ActiveStatus;
  isOnline: boolean;
  isBusy: boolean;
  lastSeenAt: string | null;
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
  const scope = await loadStaffScope(supabase, userId);
  return { role: scope.role, status: "active", zone_id: scope.zoneId, zone_ids: scope.zoneIds };
}

/** expert_id -> assigned zones (id + name), primary first */
async function loadExpertZones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  expertIds: string[],
): Promise<Map<string, Array<{ id: string; name: string; isPrimary: boolean }>>> {
  const out = new Map<string, Array<{ id: string; name: string; isPrimary: boolean }>>();
  if (!expertIds.length) return out;
  const { data: links } = await supabase
    .from("expert_zones")
    .select("expert_id, zone_id, is_primary")
    .in("expert_id", expertIds);
  const rows = (links ?? []) as { expert_id: string; zone_id: string; is_primary: boolean }[];
  if (!rows.length) return out;
  const zoneIds = Array.from(new Set(rows.map((r) => r.zone_id)));
  const { data: zones } = await supabase.from("zones").select("id, name").in("id", zoneIds);
  const nameById = new Map(
    ((zones ?? []) as { id: string; name: string }[]).map((z) => [z.id, z.name]),
  );
  for (const r of rows) {
    const list = out.get(r.expert_id) ?? [];
    list.push({ id: r.zone_id, name: nameById.get(r.zone_id) ?? "—", isPrimary: !!r.is_primary });
    out.set(r.expert_id, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
  }
  return out;
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

    // Zone scoping / filtering — an expert may cover several zones.
    let wantedZoneIds: string[] | null = null;
    if (staff.role === "area_partner") {
      if (!staff.zone_ids.length) return [];
      wantedZoneIds = staff.zone_ids;
    } else if (data.zoneId) {
      wantedZoneIds = [data.zoneId];
    }
    if (wantedZoneIds) {
      const { data: links } = await context.supabase
        .from("expert_zones")
        .select("expert_id")
        .in("zone_id", wantedZoneIds);
      const ids = Array.from(
        new Set(((links ?? []) as { expert_id: string }[]).map((l) => l.expert_id)),
      );
      if (!ids.length) return [];
      q = q.in("id", ids);
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
    const zonesByExpert = await loadExpertZones(
      context.supabase,
      raw.map((r) => r.id),
    );
    return raw.map((r) => {
      const list = zonesByExpert.get(r.id) ?? [];
      const primary = list.find((z) => z.isPrimary) ?? list[0] ?? null;
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        photoUrl: r.photo_url ?? null,
        zoneId: primary?.id ?? r.zone_id ?? null,
        zoneName: primary?.name ?? null,
        zoneIds: list.map((z) => z.id),
        zoneNames: list.map((z) => z.name),
        level: r.level as ExpertLevel,
        kycStatus: r.kyc_status as KycStatus,
        walletBalance: r.wallet_balance != null ? Number(r.wallet_balance) : 0,
        status: r.status as ActiveStatus,
        isOnline: !!r.is_online,
        isBusy: !!r.is_busy,
        lastSeenAt: r.location_updated_at ?? null,
      };
    });
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
      isOnline: !!e.is_online,
      isBusy: !!e.is_busy,
      lastSeenAt: e.location_updated_at ?? null,
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

export const forceExpertOffline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { expertId: string }) => {
    if (!input?.expertId) throw new Error("expertId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_force_expert_offline", {
      _expert_id: data.expertId,
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
