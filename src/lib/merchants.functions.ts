import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MerchantStatus = "draft" | "pending_review" | "approved" | "rejected" | "suspended";

export type MerchantDoc = {
  id: string;
  docType: string;
  url: string | null;
  uploadedAt: string;
};

export type MerchantRow = {
  id: string;
  storeName: string | null;
  ownerName: string | null;
  phone: string;
  status: MerchantStatus;
  isGstRegistered: boolean | null;
  gstin: string | null;
  gstLegalName: string | null;
  gstStatus: string | null;
  categoryName: string | null;
  segmentName: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  onboardingStep: number;
  createdAt: string;
  updatedAt: string;
  docs: MerchantDoc[];
};

async function assertStaff(
  db: ReturnType<typeof Object> extends never ? never : any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
) {
  const { data } = await db
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) {
    throw new Error("insufficient_role");
  }
}

export const listMerchants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: MerchantStatus | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<MerchantRow[]> => {
    const db = context.supabase;
    await assertStaff(db, context.userId);

    let q = db
      .from("merchants")
      .select(
        "id, store_name, owner_name, phone, status, is_gst_registered, gstin, gst_legal_name, gst_status, store_category_id, segment_id, address, city, pincode, onboarding_step, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status) q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];
    if (!raw.length) return [];

    const merchantIds = raw.map((r) => r.id);
    const catIds = Array.from(new Set(raw.map((r) => r.store_category_id).filter(Boolean)));
    const segIds = Array.from(new Set(raw.map((r) => r.segment_id).filter(Boolean)));

    const [{ data: cats }, { data: segs }, { data: docs }] = await Promise.all([
      catIds.length
        ? db.from("store_categories").select("id, name").in("id", catIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      segIds.length
        ? db.from("segments").select("id, name").in("id", segIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      db
        .from("merchant_documents")
        .select("id, merchant_id, doc_type, file_url, uploaded_at")
        .in("merchant_id", merchantIds),
    ]);

    const catMap = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    const segMap = new Map(((segs ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

    // Private bucket → sign each stored path for viewing.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawDocs = (docs ?? []) as any[];
    const signed = await Promise.all(
      rawDocs.map(async (d) => {
        const value: string = d.file_url ?? "";
        if (!value) return { ...d, signedUrl: null as string | null };
        if (/^https?:\/\//i.test(value)) return { ...d, signedUrl: value };
        const path = value.replace(/^merchant-documents\//, "");
        const { data: s } = await supabaseAdmin.storage
          .from("merchant-documents")
          .createSignedUrl(path, 60 * 10);
        return { ...d, signedUrl: s?.signedUrl ?? null };
      }),
    );

    const docsByMerchant = new Map<string, MerchantDoc[]>();
    for (const d of signed) {
      const list = docsByMerchant.get(d.merchant_id) ?? [];
      list.push({ id: d.id, docType: d.doc_type, url: d.signedUrl, uploadedAt: d.uploaded_at });
      docsByMerchant.set(d.merchant_id, list);
    }

    return raw.map((r) => ({
      id: r.id,
      storeName: r.store_name,
      ownerName: r.owner_name,
      phone: r.phone,
      status: r.status as MerchantStatus,
      isGstRegistered: r.is_gst_registered,
      gstin: r.gstin,
      gstLegalName: r.gst_legal_name,
      gstStatus: r.gst_status,
      categoryName: r.store_category_id ? (catMap.get(r.store_category_id) ?? null) : null,
      segmentName: r.segment_id ? (segMap.get(r.segment_id) ?? null) : null,
      address: r.address,
      city: r.city,
      pincode: r.pincode,
      onboardingStep: r.onboarding_step ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      docs: docsByMerchant.get(r.id) ?? [],
    }));
  });

export const decideMerchant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { merchantId: string; decision: "approved" | "rejected"; notes?: string | null }) =>
      input,
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_decide_merchant", {
      _merchant_id: data.merchantId,
      _decision: data.decision,
      _notes: data.notes ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
