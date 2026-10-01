import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LeadStatus = "new" | "called" | "quote_sent" | "renewed" | "lost";

export type VehicleRow = {
  id: string;
  customerName: string;
  customerPhone: string;
  userId: string | null;
  regNumber: string;
  vehicleType: "car" | "bike";
  makeModel: string | null;
  insurer: string | null;
  insuranceExpiry: string | null;
  pucExpiry: string | null;
  consent: boolean;
  source: string;
  expertId: string | null;
  expertName: string | null;
  bookingId: string | null;
  photos: string[];
  archived: boolean;
  createdAt: string;
  leadId: string | null;
  status: LeadStatus;
  nextFollowup: string | null;
  assignedTo: string | null;
  assignedName: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function requireOps(db: Db, userId: string) {
  const { data, error } = await db
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || !["super_admin", "ops_manager"].includes(data.role)) {
    throw new Error("Forbidden");
  }
}

export const listVehicles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VehicleRow[]> => {
    const db: Db = context.supabase;
    await requireOps(db, context.userId);
    const { data, error } = await db
      .from("vehicles")
      .select("*, vehicle_leads(id, status, next_followup_date, assigned_to)")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[];
    const expertIds = [...new Set(rows.map((r) => r.expert_id).filter(Boolean))];
    const staffIds = [
      ...new Set(
        rows
          .map((r) => (Array.isArray(r.vehicle_leads) ? r.vehicle_leads[0] : r.vehicle_leads)?.assigned_to)
          .filter(Boolean),
      ),
    ];
    const expertName = new Map<string, string>();
    const staffName = new Map<string, string>();
    if (expertIds.length) {
      const { data: ex } = await db.from("experts").select("id, name").in("id", expertIds);
      for (const e of ex ?? []) expertName.set(e.id, e.name);
    }
    if (staffIds.length) {
      const { data: st } = await db.from("staff_users").select("id, name").in("id", staffIds);
      for (const s of st ?? []) staffName.set(s.id, s.name);
    }
    return rows.map((r) => {
      const l = Array.isArray(r.vehicle_leads) ? r.vehicle_leads[0] : r.vehicle_leads;
      return {
        id: r.id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        userId: r.user_id,
        regNumber: r.reg_number,
        vehicleType: r.vehicle_type,
        makeModel: r.make_model,
        insurer: r.insurer,
        insuranceExpiry: r.insurance_expiry,
        pucExpiry: r.puc_expiry,
        consent: !!r.consent_reminder,
        source: r.source,
        expertId: r.expert_id,
        expertName: r.expert_id ? expertName.get(r.expert_id) ?? null : null,
        bookingId: r.booking_id,
        photos: r.photos ?? [],
        archived: !!r.archived,
        createdAt: r.created_at,
        leadId: l?.id ?? null,
        status: (l?.status ?? "new") as LeadStatus,
        nextFollowup: l?.next_followup_date ?? null,
        assignedTo: l?.assigned_to ?? null,
        assignedName: l?.assigned_to ? staffName.get(l.assigned_to) ?? null : null,
      };
    });
  });

export const getInsuranceOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db: Db = context.supabase;
    await requireOps(db, context.userId);
    const [{ data: ex }, { data: st }, { data: stats, error: sErr }] = await Promise.all([
      db.from("experts").select("id, name").order("name"),
      db.from("staff_users").select("id, name, role, status").eq("status", "active").order("name"),
      db.rpc("staff_insurance_stats"),
    ]);
    if (sErr) throw new Error(sErr.message);
    return {
      experts: ((ex ?? []) as { id: string; name: string }[]).map((e) => ({ id: e.id, name: e.name })),
      staff: ((st ?? []) as { id: string; name: string; role: string }[])
        .filter((s) => s.role !== "area_partner")
        .map((s) => ({ id: s.id, name: s.name })),
      stats: (stats ?? { due: 0, renewed: 0, conversion: 0 }) as {
        due: number;
        renewed: number;
        conversion: number;
      },
    };
  });

export const getLeadNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { leadId: string }) => {
    if (!i?.leadId) throw new Error("leadId required");
    return i;
  })
  .handler(async ({ data, context }) => {
    const db: Db = context.supabase;
    await requireOps(db, context.userId);
    const { data: rows, error } = await db
      .from("vehicle_lead_notes")
      .select("id, author_name, note, created_at")
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as { id: string; author_name: string | null; note: string; created_at: string }[]).map(
      (n) => ({ id: n.id, author: n.author_name, note: n.note, createdAt: n.created_at }),
    );
  });

export type UpsertVehicleInput = {
  id: string | null;
  customerName: string;
  customerPhone: string;
  regNumber: string;
  vehicleType: "car" | "bike";
  makeModel: string;
  insurer: string;
  insuranceExpiry: string | null;
  pucExpiry: string | null;
  consent: boolean;
  expertId: string | null;
  bookingId: string | null;
  photos: string[];
};

export const upsertVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: UpsertVehicleInput) => {
    if (!i?.customerName?.trim()) throw new Error("Customer name required");
    const phone = (i.customerPhone ?? "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) throw new Error("Mobile must have 10 digits");
    const reg = (i.regNumber ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (reg.length < 4) throw new Error("Valid vehicle number required");
    if (!["car", "bike"].includes(i.vehicleType)) throw new Error("Choose car or bike");
    return { ...i, customerPhone: phone, regNumber: reg };
  })
  .handler(async ({ data, context }) => {
    const db: Db = context.supabase;
    await requireOps(db, context.userId);
    const { data: res, error } = await db.rpc("staff_upsert_vehicle", {
      _id: data.id,
      _customer_name: data.customerName,
      _customer_phone: data.customerPhone,
      _reg_number: data.regNumber,
      _vehicle_type: data.vehicleType,
      _make_model: data.makeModel,
      _insurer: data.insurer,
      _insurance_expiry: data.insuranceExpiry || null,
      _puc_expiry: data.pucExpiry || null,
      _consent: data.consent,
      _expert_id: data.expertId || null,
      _booking_id: data.bookingId || null,
      _photos: data.photos,
    });
    if (error) throw new Error(error.message);
    return res as { id: string; duplicate: boolean };
  });

export const setVehicleArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; archived: boolean }) => i)
  .handler(async ({ data, context }) => {
    const db: Db = context.supabase;
    await requireOps(db, context.userId);
    const { error } = await db.rpc("staff_set_vehicle_archived", { _id: data.id, _archived: data.archived });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateVehicleLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { leadId: string; status: LeadStatus; nextFollowup: string | null; assignedTo: string | null; note: string }) => {
      if (!i?.leadId) throw new Error("leadId required");
      if (!["new", "called", "quote_sent", "renewed", "lost"].includes(i.status)) throw new Error("Invalid status");
      return { ...i, note: (i.note ?? "").slice(0, 2000) };
    },
  )
  .handler(async ({ data, context }) => {
    const db: Db = context.supabase;
    await requireOps(db, context.userId);
    const { error } = await db.rpc("staff_update_vehicle_lead", {
      _lead_id: data.leadId,
      _status: data.status,
      _next_followup_date: data.nextFollowup || null,
      _assigned_to: data.assignedTo || null,
      _note: data.note,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
