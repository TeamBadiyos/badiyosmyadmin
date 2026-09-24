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
        "id, store_name, owner_name, phone, status, store_category_id, segment_id, zone_id, address, city, pincode, state, is_accepting_orders, is_gst_registered, gstin, gst_legal_name",
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
    };
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
  isActive: boolean;
  adminHidden: boolean;
  adminHiddenReason: string | null;
  imageUrl: string | null;
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
          "id, name, description, category_label, price, unit, stock_quantity, low_stock_threshold, is_active, admin_hidden, admin_hidden_reason, image_url, created_at",
        )
        .eq("merchant_id", data.merchantId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (error) throw new Error(error.message);

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
        isActive: !!r.is_active,
        adminHidden: !!r.admin_hidden,
        adminHiddenReason: r.admin_hidden_reason ?? null,
        imageUrl: r.image_url ?? null,
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
