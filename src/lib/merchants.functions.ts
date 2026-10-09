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
  commissionPct: number;
  bankHolder: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  rejectionReason: string | null;
  queryNotes: string | null;
  queryDocTypes: string[] | null;
  queriedAt: string | null;
  awaitingReupload: boolean;
  reuploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
  docs: MerchantDoc[];
  pendingItems: number;
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
        "id, store_name, owner_name, phone, status, is_gst_registered, gstin, gst_legal_name, gst_status, store_category_id, segment_id, address, city, pincode, onboarding_step, commission_value, bank_account_holder_name, bank_account_number, bank_ifsc, pan, rejection_reason, query_notes, query_doc_types, queried_at, awaiting_reupload, reuploaded_at, created_at, updated_at",
      )
      .is("deleted_at", null)
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

    const [{ data: cats }, { data: segs }, { data: docs }, { data: pendingRows }] = await Promise.all([
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .from("products")
        .select("merchant_id")
        .eq("approval_status", "pending")
        .in("merchant_id", merchantIds)
        .limit(5000),
    ]);
    const pendingByMerchant = new Map<string, number>();
    for (const r of (pendingRows ?? []) as { merchant_id: string }[]) {
      pendingByMerchant.set(r.merchant_id, (pendingByMerchant.get(r.merchant_id) ?? 0) + 1);
    }

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
      commissionPct: Number(r.commission_value ?? 0),
      bankHolder: r.bank_account_holder_name ?? null,
      bankAccount: r.bank_account_number ?? null,
      bankIfsc: r.bank_ifsc ?? null,
      pan: r.pan ?? null,
      rejectionReason: r.rejection_reason ?? null,
      queryNotes: r.query_notes ?? null,
      queryDocTypes: r.query_doc_types ?? null,
      queriedAt: r.queried_at ?? null,
      awaitingReupload: Boolean(r.awaiting_reupload),
      reuploadedAt: r.reuploaded_at ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      docs: docsByMerchant.get(r.id) ?? [],
      pendingItems: pendingByMerchant.get(r.id) ?? 0,
    }));
  });

export const decideMerchant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { merchantId: string; decision: "approved" | "rejected"; notes?: string | null }) => {
      if (input.decision === "rejected" && !input.notes?.trim()) {
        throw new Error("A rejection reason is required.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_decide_merchant", {
      _merchant_id: data.merchantId,
      _decision: data.decision,
      _notes: data.notes?.trim() || undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Ask a merchant to re-upload specific documents; sends them a notification. */
export const raiseMerchantQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { merchantId: string; docTypes: string[]; notes: string }) => {
    if (!input.merchantId) throw new Error("merchantId required");
    if (!input.docTypes?.length) throw new Error("Select at least one document.");
    if (!input.notes?.trim()) throw new Error("Write what the merchant must fix.");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_merchant_raise_query", {
      _merchant_id: data.merchantId,
      _doc_types: data.docTypes,
      _notes: data.notes.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Edit merchant details (staff only, fully audited)
// ---------------------------------------------------------------------------

export type MerchantEditOptions = {
  categories: { id: string; name: string; segment_id: string }[];
  segments: { id: string; name: string }[];
  zones: { id: string; name: string; city: string }[];
};

export const listMerchantEditOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MerchantEditOptions> => {
    const db = context.supabase;
    await assertStaff(db, context.userId);

    const [cats, segs, zones] = await Promise.all([
      db
        .from("store_categories")
        .select("id, name, segment_id, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      db.from("segments").select("id, name, vertical_type").eq("vertical_type", "CATALOG"),
      db
        .from("zones")
        .select("id, name, city, status, deleted_at")
        .is("deleted_at", null)
        .order("name", { ascending: true }),
    ]);

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      categories: ((cats.data ?? []) as any[]).map((c) => ({
        id: c.id,
        name: c.name,
        segment_id: c.segment_id,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      segments: ((segs.data ?? []) as any[]).map((s) => ({ id: s.id, name: s.name })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zones: ((zones.data ?? []) as any[]).map((z) => ({ id: z.id, name: z.name, city: z.city })),
    };
  });

export type MerchantDetail = {
  id: string;
  storeName: string | null;
  ownerName: string | null;
  phone: string;
  status: MerchantStatus;
  storeCategoryId: string | null;
  segmentId: string | null;
  zoneId: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  state: string | null;
  isAcceptingOrders: boolean;
  isGstRegistered: boolean | null;
  gstin: string | null;
  gstLegalName: string | null;
  bankHolder: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  commissionPct: number;
  deletedAt: string | null;
  deleteReason: string | null;
};

export const getMerchantDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { merchantId: string }) => {
    if (!input?.merchantId) throw new Error("Merchant is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<MerchantDetail> => {
    const db = context.supabase;
    await assertStaff(db, context.userId);
    const { data: m, error } = await db
      .from("merchants")
      .select(
        "id, store_name, owner_name, phone, status, store_category_id, segment_id, zone_id, address, city, pincode, state, is_accepting_orders, is_gst_registered, gstin, gst_legal_name, bank_account_holder_name, bank_account_number, bank_ifsc, pan, commission_value, deleted_at, delete_reason",
      )
      .eq("id", data.merchantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!m) throw new Error("Merchant not found");
    return {
      id: m.id,
      storeName: m.store_name,
      ownerName: m.owner_name,
      phone: m.phone,
      status: m.status as MerchantStatus,
      storeCategoryId: m.store_category_id,
      segmentId: m.segment_id,
      zoneId: m.zone_id,
      address: m.address,
      city: m.city,
      pincode: m.pincode,
      state: m.state,
      isAcceptingOrders: !!m.is_accepting_orders,
      isGstRegistered: m.is_gst_registered,
      gstin: m.gstin,
      gstLegalName: m.gst_legal_name,
      bankHolder: m.bank_account_holder_name ?? null,
      bankAccount: m.bank_account_number ?? null,
      bankIfsc: m.bank_ifsc ?? null,
      pan: m.pan ?? null,
      commissionPct: Number(m.commission_value ?? 0),
      deletedAt: m.deleted_at ?? null,
      deleteReason: m.delete_reason ?? null,
    };
  });

export const deleteMerchant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { merchantId: string; reason: string }) => {
    if (!input?.merchantId) throw new Error("Merchant is required");
    if (!input.reason?.trim()) throw new Error("A reason is required to delete a store");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_soft_delete_merchant", {
      _merchant_id: data.merchantId,
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type UpdateMerchantInput = {
  merchantId: string;
  storeName: string;
  ownerName: string | null;
  phone: string;
  storeCategoryId: string | null;
  segmentId: string | null;
  zoneId: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  state: string | null;
  isAcceptingOrders: boolean;
  status: MerchantStatus;
  isGstRegistered: boolean;
  gstin: string | null;
  gstLegalName: string | null;
  bankHolder?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  pan?: string | null;
};

export const updateMerchantDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateMerchantInput) => {
    if (!input?.merchantId) throw new Error("Merchant is required");
    if (!input.storeName?.trim()) throw new Error("Store name is required");
    if (!/^\d{10}$/.test((input.phone ?? "").replace(/\D/g, "").slice(-10)))
      throw new Error("Enter a valid 10-digit phone number");
    if (input.pincode && !/^\d{6}$/.test(input.pincode.trim()))
      throw new Error("Pincode must be 6 digits");
    if (input.isGstRegistered && !input.gstin?.trim())
      throw new Error("GSTIN is required when GST registered is on");
    if (input.bankIfsc?.trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(input.bankIfsc.trim()))
      throw new Error("IFSC must look like ABCD0123456");
    if (input.pan?.trim() && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(input.pan.trim()))
      throw new Error("PAN must look like ABCDE1234F");
    if (input.bankAccount?.trim() && !/^\d{6,18}$/.test(input.bankAccount.trim()))
      throw new Error("Account number must be 6-18 digits");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = context.supabase;
    await assertStaff(db, context.userId);

    const { data: before, error: beforeErr } = await db
      .from("merchants")
      .select("*")
      .eq("id", data.merchantId)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("Merchant not found");

    const trimmed = (v: string | null | undefined) => {
      const s = (v ?? "").trim();
      return s.length ? s : null;
    };

    const patch = {
      store_name: data.storeName.trim(),
      owner_name: trimmed(data.ownerName),
      phone: data.phone.replace(/\D/g, "").slice(-10),
      store_category_id: data.storeCategoryId || null,
      segment_id: data.segmentId || null,
      zone_id: data.zoneId || null,
      address: trimmed(data.address),
      city: trimmed(data.city),
      pincode: trimmed(data.pincode),
      state: trimmed(data.state),
      is_accepting_orders: data.isAcceptingOrders,
      status: data.status,
      is_gst_registered: data.isGstRegistered,
      gstin: data.isGstRegistered ? trimmed(data.gstin) : null,
      gst_legal_name: data.isGstRegistered ? trimmed(data.gstLegalName) : null,
      bank_account_holder_name: trimmed(data.bankHolder),
      bank_account_number: trimmed(data.bankAccount),
      bank_ifsc: trimmed(data.bankIfsc)?.toUpperCase() ?? null,
      pan: trimmed(data.pan)?.toUpperCase() ?? null,
    };

    const { data: after, error } = await db
      .from("merchants")
      .update(patch)
      .eq("id", data.merchantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "update_merchant_details",
      target_table: "merchants",
      target_id: data.merchantId,
      before_state: before,
      after_state: after,
    });

    return { ok: true };
  });

export type MerchantProduct = {
  id: string;
  name: string;
  description: string | null;
  categoryLabel: string | null;
  price: number;
  unit: string | null;
  stockQuantity: number;
  lowStockThreshold: number;
  hsnSacCode: string | null;
  gstRate: number;
  isActive: boolean;
  adminHidden: boolean;
  adminHiddenReason: string | null;
  approvalStatus: "pending" | "approved" | "rejected" | "query_raised";
  approvalReason: string | null;
  imageUrl: string | null;
  imageUrl2: string | null;
  createdAt: string;
};

export type MerchantProductsResult = {
  role: "super_admin" | "ops_manager";
  storeName: string | null;
  ownerName: string | null;
  phone: string | null;
  products: MerchantProduct[];
};

async function staffRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
): Promise<"super_admin" | "ops_manager"> {
  const { data } = await db
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) {
    throw new Error("insufficient_role");
  }
  return data.role as "super_admin" | "ops_manager";
}

export const listMerchantProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { merchantId: string }) => input)
  .handler(async ({ data, context }): Promise<MerchantProductsResult> => {
    const db = context.supabase;
    const role = await staffRole(db, context.userId);

    const [{ data: merchant }, { data: rows, error }] = await Promise.all([
      db
        .from("merchants")
        .select("store_name, owner_name, phone")
        .eq("id", data.merchantId)
        .maybeSingle(),
      db
        .from("products")
        .select(
          "id, name, description, category_label, price, unit, stock_quantity, low_stock_threshold, hsn_sac_code, gst_rate, is_active, admin_hidden, admin_hidden_reason, approval_status, approval_reason, image_url, image_url_2, created_at",
        )
        .eq("merchant_id", data.merchantId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (error) throw new Error(error.message);

    // Product photos live in the public catalog bucket (custom-domain URLs).
    const { catalogImageUrl } = await import("@/lib/catalog-images");
    const resolve = (u: string | null | undefined) => catalogImageUrl(u);

    return {
      role,
      storeName: merchant?.store_name ?? null,
      ownerName: merchant?.owner_name ?? null,
      phone: merchant?.phone ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      products: ((rows ?? []) as any[]).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        categoryLabel: r.category_label ?? null,
        price: Number(r.price ?? 0),
        unit: r.unit ?? null,
        stockQuantity: Number(r.stock_quantity ?? 0),
        lowStockThreshold: Number(r.low_stock_threshold ?? 0),
        hsnSacCode: r.hsn_sac_code ?? null,
        gstRate: Number(r.gst_rate ?? 0),
        isActive: !!r.is_active,
        adminHidden: !!r.admin_hidden,
        adminHiddenReason: r.admin_hidden_reason ?? null,
        approvalStatus: (r.approval_status ?? "approved") as MerchantProduct["approvalStatus"],
        approvalReason: r.approval_reason ?? null,
        imageUrl: resolve(r.image_url),
        imageUrl2: resolve(r.image_url_2),
        createdAt: r.created_at,
      })),
    };
  });

export const setProductAdminHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string; hidden: boolean; reason?: string | null }) => {
    if (!input?.productId) throw new Error("Product is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = context.supabase;
    const role = await staffRole(db, context.userId);
    if (role !== "super_admin") throw new Error("insufficient_role");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;

    const { data: before, error: beforeErr } = await admin
      .from("products")
      .select("*")
      .eq("id", data.productId)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("Product not found");

    const reason = data.hidden ? (data.reason ?? "").trim() || null : null;
    const { data: after, error } = await admin
      .from("products")
      .update({ admin_hidden: data.hidden, admin_hidden_reason: reason })
      .eq("id", data.productId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "set_product_admin_hidden",
      target_table: "products",
      target_id: data.productId,
      before_state: before,
      after_state: after,
    });

    return { ok: true };
  });

export type UpdateProductInput = {
  productId: string;
  name: string;
  description: string | null;
  categoryLabel: string | null;
  price: number;
  unit: string | null;
  stockQuantity: number;
  lowStockThreshold: number;
  hsnSacCode: string | null;
  gstRate: number;
  isActive: boolean;
  // undefined = keep, null = remove, {base64,contentType,thumbBase64} = replace
  photo1?: { base64: string; contentType: string; thumbBase64: string } | null;
  photo2?: { base64: string; contentType: string; thumbBase64: string } | null;
};

export const updateMerchantProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateProductInput) => {
    if (!input?.productId) throw new Error("Product is required");
    if (!input.name?.trim()) throw new Error("Name is required");
    if (!(Number(input.price) >= 0)) throw new Error("Price must be 0 or more");
    if (!(Number(input.stockQuantity) >= 0)) throw new Error("Stock must be 0 or more");
    for (const p of [input.photo1, input.photo2]) {
      if (p && p.base64.length > 7_000_000) throw new Error("Photo too large (max ~5 MB)");
      if (p && !["image/jpeg", "image/png", "image/webp"].includes(p.contentType))
        throw new Error("Only JPG, PNG or WebP photos allowed");
      if (p && !p.thumbBase64) throw new Error("Photo thumbnail missing");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await staffRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { CATALOG_BUCKET, catalogThumbPath } = await import("@/lib/catalog-images");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data: before, error: bErr } = await admin
      .from("products").select("*").eq("id", data.productId).maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new Error("Product not found");

    const upload = async (p: { base64: string; contentType: string; thumbBase64: string }, slot: number) => {
      const ext = (p.contentType.split("/")[1] ?? "jpg").replace("jpeg", "jpg").slice(0, 5);
      const path = `${before.merchant_id}/product-${Date.now()}-${slot}.${ext}`;
      const bucket = admin.storage.from(CATALOG_BUCKET);
      const { error } = await bucket.upload(path, Buffer.from(p.base64, "base64"), {
        contentType: p.contentType, upsert: false, cacheControl: "31536000",
      });
      if (error) throw new Error(`Photo upload failed: ${error.message}`);
      const { error: tErr } = await bucket.upload(catalogThumbPath(path), Buffer.from(p.thumbBase64, "base64"), {
        contentType: "image/webp", upsert: true, cacheControl: "31536000",
      });
      if (tErr) throw new Error(`Thumbnail upload failed: ${tErr.message}`);
      return path;
    };

    const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {
      name: data.name.trim(),
      description: t(data.description),
      category_label: t(data.categoryLabel),
      price: Number(data.price),
      unit: t(data.unit),
      stock_quantity: Math.floor(Number(data.stockQuantity)),
      low_stock_threshold: Math.floor(Number(data.lowStockThreshold) || 0),
      hsn_sac_code: t(data.hsnSacCode),
      gst_rate: Number(data.gstRate) || 0,
      is_active: !!data.isActive,
    };
    if (data.photo1 !== undefined) patch.image_url = data.photo1 ? await upload(data.photo1, 1) : null;
    if (data.photo2 !== undefined) patch.image_url_2 = data.photo2 ? await upload(data.photo2, 2) : null;

    const { data: after, error } = await admin
      .from("products").update(patch).eq("id", data.productId).select("*").single();
    if (error) throw new Error(error.message);
    await admin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "update_product_details",
      target_table: "products",
      target_id: data.productId,
      before_state: before,
      after_state: after,
    });
    return { ok: true };
  });

export const raiseProductQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productIds: string[]; reason: string }) => {
    if (!input?.productIds?.length) throw new Error("Select at least one item");
    if (!input.reason?.trim()) throw new Error("Query reason is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true; count: number }> => {
    await staffRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data: before, error: bErr } = await admin
      .from("products").select("id, name, merchant_id, approval_status, approval_reason")
      .in("id", data.productIds);
    if (bErr) throw new Error(bErr.message);
    const reason = data.reason.trim();
    const { error } = await admin.from("products").update({
      approval_status: "query_raised",
      approval_reason: reason,
      approval_reviewed_at: new Date().toISOString(),
      approval_reviewed_by: context.userId,
    }).in("id", data.productIds);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of (before ?? []) as any[]) {
      await admin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "product_query_raised",
        target_table: "products",
        target_id: b.id,
        before_state: b,
        after_state: { approval_status: "query_raised", approval_reason: reason },
      });
    }
    return { ok: true, count: (before ?? []).length };
  });

export const setProductApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { productIds: string[]; decision: "approved" | "rejected"; reason?: string | null }) => {
      if (!input?.productIds?.length) throw new Error("Select at least one item");
      if (input.decision === "rejected" && !(input.reason ?? "").trim())
        throw new Error("Rejection reason is required");
      return input;
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: true; count: number }> => {
    await staffRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = supabaseAdmin as any;
    const { data: before, error: bErr } = await admin
      .from("products")
      .select("id, name, merchant_id, approval_status, approval_reason")
      .in("id", data.productIds);
    if (bErr) throw new Error(bErr.message);
    const reason = data.decision === "rejected" ? (data.reason ?? "").trim() : null;
    const { error } = await admin
      .from("products")
      .update({
        approval_status: data.decision,
        approval_reason: reason,
        approval_reviewed_at: new Date().toISOString(),
        approval_reviewed_by: context.userId,
      })
      .in("id", data.productIds);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of (before ?? []) as any[]) {
      await admin.from("audit_logs").insert({
        actor_id: context.userId,
        action: `product_${data.decision}`,
        target_table: "products",
        target_id: b.id,
        before_state: b,
        after_state: { approval_status: data.decision, approval_reason: reason },
      });
    }
    return { ok: true, count: (before ?? []).length };
  });

// ---------------------------------------------------------------------------
// Store commission controls (ops_settings + per-merchant RPC)
// ---------------------------------------------------------------------------

export type StoreCommissionSettings = {
  defaultPct: number;
  gstEnabled: boolean;
  gstPct: number;
  canEdit: boolean;
};

const COMMISSION_KEYS = [
  "store_default_commission_pct",
  "store_commission_gst_enabled",
  "store_commission_gst_pct",
] as const;

export const getStoreCommissionSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoreCommissionSettings> => {
    const db = context.supabase;
    const role = await staffRole(db, context.userId);
    const { data, error } = await db
      .from("ops_settings")
      .select("key, value")
      .in("key", COMMISSION_KEYS as unknown as string[]);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = new Map(((data ?? []) as any[]).map((r) => [r.key, String(r.value ?? "")]));
    return {
      defaultPct: Number(m.get("store_default_commission_pct") ?? 0),
      gstEnabled: (m.get("store_commission_gst_enabled") ?? "0") === "1",
      gstPct: Number(m.get("store_commission_gst_pct") ?? 18),
      canEdit: role === "super_admin",
    };
  });

export const saveStoreCommissionSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { defaultPct: number; gstEnabled: boolean; gstPct: number }) => {
    if (!Number.isFinite(input.defaultPct) || input.defaultPct < 0 || input.defaultPct > 50) {
      throw new Error("Default commission must be between 0 and 50%");
    }
    if (!Number.isFinite(input.gstPct) || input.gstPct < 0 || input.gstPct > 100) {
      throw new Error("GST % must be between 0 and 100");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = context.supabase;
    const role = await staffRole(db, context.userId);
    if (role !== "super_admin") throw new Error("insufficient_role");

    const { data: before } = await db
      .from("ops_settings")
      .select("key, value")
      .in("key", COMMISSION_KEYS as unknown as string[]);

    const updates: Array<[string, string]> = [
      ["store_default_commission_pct", String(data.defaultPct)],
      ["store_commission_gst_enabled", data.gstEnabled ? "1" : "0"],
      ["store_commission_gst_pct", String(data.gstPct)],
    ];
    for (const [key, value] of updates) {
      const { data: upd, error } = await db
        .from("ops_settings")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("key", key)
        .select("key");
      if (error) throw new Error(error.message);
      if (!upd?.length) throw new Error(`Setting ${key} not found`);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "update_store_commission_settings",
      target_table: "ops_settings",
      target_id: null,
      before_state: before ?? null,
      after_state: data,
    });
    return { ok: true };
  });

export const setMerchantCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { merchantId: string; pct: number }) => {
    if (!input?.merchantId) throw new Error("merchantId required");
    if (!Number.isFinite(input.pct) || input.pct < 0 || input.pct > 50) {
      throw new Error("Commission must be between 0 and 50%");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_set_merchant_commission", {
      _merchant_id: data.merchantId,
      _pct: data.pct,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------- live stores */

export type LiveStoreItem = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  unit: string | null;
  stock: number;
  inStock: boolean;
  imageUrl: string | null;
  thumbUrl: string | null;
};

export type LiveStore = {
  id: string;
  storeName: string;
  ownerName: string | null;
  phone: string;
  categoryName: string | null;
  segmentName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  acceptingOrders: boolean;
  storeEnabled: boolean;
  deliveryEnabled: boolean;
  commissionPct: number;
  approvedAt: string | null;
  zoneName: string | null;
  fulfillmentMode: string | null;
  deliveryFeePayer: string | null;
  hours: { day: number; open: string | null; close: string | null; closed: boolean }[];
  items: LiveStoreItem[];
};

export const listLiveStores = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LiveStore[]> => {
    const db = context.supabase;
    await assertStaff(db, context.userId);
    const { data: rows, error } = await db
      .from("merchants")
      .select(
        "id, store_name, owner_name, phone, store_category_id, segment_id, address, city, state, pincode, latitude, longitude, shop_photo_url, is_accepting_orders, store_enabled, delivery_enabled, commission_value, approved_at, zone_id, fulfillment_mode, delivery_fee_payer",
      )
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("store_name", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = (rows ?? []) as any[];
    if (!ms.length) return [];
    const ids = ms.map((m) => m.id);
    const catIds = [...new Set(ms.map((m) => m.store_category_id).filter(Boolean))];
    const segIds = [...new Set(ms.map((m) => m.segment_id).filter(Boolean))];
    const zoneIds = [...new Set(ms.map((m) => m.zone_id).filter(Boolean))];
    const [{ data: zs }, { data: hrs }] = await Promise.all([
      zoneIds.length ? db.from("zones").select("id, name").in("id", zoneIds) : Promise.resolve({ data: [] }),
      db.from("merchant_store_hours").select("merchant_id, day_of_week, open_time, close_time, is_closed").in("merchant_id", ids),
    ]);
    const zMap = new Map(((zs ?? []) as { id: string; name: string }[]).map((z) => [z.id, z.name]));
    const hMap = new Map<string, LiveStore["hours"]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const h of (hrs ?? []) as any[]) {
      const l = hMap.get(h.merchant_id) ?? [];
      l.push({ day: h.day_of_week, open: h.open_time, close: h.close_time, closed: !!h.is_closed });
      hMap.set(h.merchant_id, l);
    }
    const [{ data: cats }, { data: segs }, { data: prods }] = await Promise.all([
      catIds.length ? db.from("store_categories").select("id, name").in("id", catIds) : Promise.resolve({ data: [] }),
      segIds.length ? db.from("segments").select("id, name").in("id", segIds) : Promise.resolve({ data: [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any)
        .from("products")
        .select("id, merchant_id, name, category_label, price, unit, stock_quantity, image_url, is_active, admin_hidden, approval_status")
        .in("merchant_id", ids)
        .eq("is_active", true)
        .eq("admin_hidden", false)
        .order("name", { ascending: true })
        .limit(5000),
    ]);
    const { catalogImageUrl, catalogThumbUrl } = await import("@/lib/catalog-images");
    const cMap = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    const sMap = new Map(((segs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
    const byM = new Map<string, LiveStoreItem[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of (prods ?? []) as any[]) {
      if (p.approval_status && p.approval_status !== "approved") continue;
      const list = byM.get(p.merchant_id) ?? [];
      list.push({
        id: p.id,
        name: p.name,
        category: p.category_label ?? null,
        price: Number(p.price ?? 0),
        unit: p.unit ?? null,
        stock: Number(p.stock_quantity ?? 0),
        inStock: Number(p.stock_quantity ?? 0) > 0,
        imageUrl: catalogImageUrl(p.image_url),
        thumbUrl: catalogThumbUrl(p.image_url),
      });
      byM.set(p.merchant_id, list);
    }
    return ms.map((m) => ({
      id: m.id,
      storeName: m.store_name || "Unnamed store",
      ownerName: m.owner_name,
      phone: m.phone,
      categoryName: m.store_category_id ? cMap.get(m.store_category_id) ?? null : null,
      segmentName: m.segment_id ? sMap.get(m.segment_id) ?? null : null,
      address: m.address,
      city: m.city,
      state: m.state,
      pincode: m.pincode,
      latitude: m.latitude,
      longitude: m.longitude,
      photoUrl: catalogImageUrl(m.shop_photo_url),
      acceptingOrders: !!m.is_accepting_orders,
      storeEnabled: !!m.store_enabled,
      deliveryEnabled: !!m.delivery_enabled,
      commissionPct: Number(m.commission_value ?? 0),
      approvedAt: m.approved_at,
      zoneName: m.zone_id ? zMap.get(m.zone_id) ?? null : null,
      fulfillmentMode: m.fulfillment_mode ?? null,
      deliveryFeePayer: m.delivery_fee_payer ?? null,
      hours: (hMap.get(m.id) ?? []).sort((a, b) => a.day - b.day),
      items: byM.get(m.id) ?? [],
    }));
  });

export type StoreAnalytics = {
  totalVisits: number;
  uniqueVisitors: number;
  loggedInVisitors: number;
  todayVisits: number;
  yesterdayVisits: number;
  orders: number;
  orderingCustomers: number;
  daily: { date: string; visits: number; unique: number; orders: number }[];
  recent: { at: string; name: string | null; phone: string | null; guest: boolean }[];
};

export const getStoreAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { merchantId: string; days: number }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { data: r, error } = await (context.supabase as any).rpc("get_merchant_store_analytics", { // eslint-disable-line @typescript-eslint/no-explicit-any
      _merchant_id: data.merchantId,
      _days: data.days,
    });
    if (error) throw new Error(error.message);
    return r as StoreAnalytics;
  });
