import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SUGGESTION_SOURCES = ["customer_app", "whatsapp", "call", "expert", "merchant", "internal"] as const;
export const SUGGESTION_CATEGORIES = ["app", "service_quality", "new_service", "price", "other"] as const;
export const SUGGESTION_PRIORITIES = ["high", "medium", "low"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];
export type SuggestionPriority = (typeof SUGGESTION_PRIORITIES)[number];

export type SuggestionStatus = {
  id: string;
  key: string;
  label: string;
  customer_label_en: string;
  customer_label_mr: string;
  color: string;
  sort_order: number;
  is_final: boolean;
  notify_customer: boolean;
  notify_message: string | null;
  active: boolean;
  usage_count: number;
};

export type Suggestion = {
  id: string;
  source: SuggestionSource;
  category: SuggestionCategory;
  text: string;
  photo_path: string | null;
  user_id: string | null;
  name: string | null;
  phone: string | null;
  status_id: string | null;
  priority: SuggestionPriority;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  final_at: string | null;
  archived: boolean;
};

type StaffInfo = { id: string; role: string; canEdit: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function staffOf(supabase: any, userId: string): Promise<StaffInfo> {
  const { data, error } = await supabase
    .from("staff_users")
    .select("id, role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  return { id: data.id, role: data.role, canEdit: ["super_admin", "ops_manager"].includes(data.role) };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function audit(db: any, actor: string, action: string, table: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_logs").insert({
    actor_id: actor,
    action,
    target_table: table,
    target_id: id,
    before_state: before ?? null,
    after_state: after ?? null,
  });
}

const clean = (s: unknown, max = 500) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/* ---------------- Statuses ---------------- */

export const listSuggestionStatuses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = await staffOf(context.supabase, context.userId);
    const db = await admin();
    const [{ data, error }, { data: rows }] = await Promise.all([
      db.from("suggestion_statuses").select("*").order("sort_order"),
      db.from("suggestions").select("status_id").eq("archived", false),
    ]);
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const r of (rows ?? []) as { status_id: string | null }[])
      if (r.status_id) counts.set(r.status_id, (counts.get(r.status_id) ?? 0) + 1);
    const statuses = ((data ?? []) as Omit<SuggestionStatus, "usage_count">[]).map((s) => ({
      ...s,
      usage_count: counts.get(s.id) ?? 0,
    }));
    return { canEdit: me.canEdit, statuses: statuses as SuggestionStatus[] };
  });

export type StatusInput = {
  id?: string | null;
  label: string;
  customer_label_en: string;
  customer_label_mr: string;
  color: string;
  is_final: boolean;
  notify_customer: boolean;
  notify_message: string | null;
};

export const upsertSuggestionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: StatusInput) => {
    if (!clean(i?.label)) throw new Error("Staff label is required");
    if (!clean(i?.customer_label_en)) throw new Error("Customer label (English) is required");
    if (!/^#[0-9a-fA-F]{6}$/.test(i.color ?? "")) throw new Error("Pick a valid color");
    if (i.notify_customer && !clean(i.notify_message)) throw new Error("Notification message is required");
    return i;
  })
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    if (!me.canEdit) throw new Error("Only Super Admin / Ops Manager can edit statuses");
    const db = await admin();
    const row = {
      label: clean(data.label, 80),
      customer_label_en: clean(data.customer_label_en, 80),
      customer_label_mr: clean(data.customer_label_mr, 80),
      color: data.color,
      is_final: !!data.is_final,
      notify_customer: !!data.notify_customer,
      notify_message: data.notify_customer ? clean(data.notify_message, 300) : clean(data.notify_message, 300) || null,
    };
    if (data.id) {
      const { data: before } = await db.from("suggestion_statuses").select("*").eq("id", data.id).maybeSingle();
      if (!before) throw new Error("Status not found");
      const { data: after, error } = await db.from("suggestion_statuses").update(row).eq("id", data.id).select("*").single();
      if (error) throw new Error(error.message);
      await audit(db, context.userId, "update_suggestion_status_config", "suggestion_statuses", data.id, before, after);
      return { ok: true };
    }
    const { data: last } = await db.from("suggestion_statuses").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const key =
      row.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) +
      "_" + Math.random().toString(36).slice(2, 6);
    const { data: after, error } = await db
      .from("suggestion_statuses")
      .insert({ ...row, key, sort_order: ((last?.[0]?.sort_order as number) ?? 0) + 1 })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await audit(db, context.userId, "create_suggestion_status", "suggestion_statuses", after.id, null, after);
    return { ok: true };
  });

export const reorderSuggestionStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { ids: string[] }) => {
    if (!Array.isArray(i?.ids) || !i.ids.length) throw new Error("Nothing to reorder");
    return i;
  })
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    if (!me.canEdit) throw new Error("Forbidden");
    const db = await admin();
    const { data: before } = await db.from("suggestion_statuses").select("id, sort_order").order("sort_order");
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await db.from("suggestion_statuses").update({ sort_order: i + 1 }).eq("id", data.ids[i]);
      if (error) throw new Error(error.message);
    }
    await audit(db, context.userId, "reorder_suggestion_statuses", "suggestion_statuses", data.ids[0], before, { order: data.ids });
    return { ok: true };
  });

export const setSuggestionStatusActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; active: boolean }) => i)
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    if (!me.canEdit) throw new Error("Forbidden");
    const db = await admin();
    if (!data.active) {
      const { count } = await db
        .from("suggestions")
        .select("id", { count: "exact", head: true })
        .eq("status_id", data.id)
        .eq("archived", false);
      if ((count ?? 0) > 0) throw new Error(`${count} suggestion(s) use this status — move them first`);
      const { count: activeCount } = await db
        .from("suggestion_statuses")
        .select("id", { count: "exact", head: true })
        .eq("active", true);
      if ((activeCount ?? 0) <= 1) throw new Error("At least one status must stay active");
    }
    const { data: before } = await db.from("suggestion_statuses").select("*").eq("id", data.id).maybeSingle();
    const { error } = await db.from("suggestion_statuses").update({ active: data.active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(db, context.userId, data.active ? "activate_suggestion_status" : "deactivate_suggestion_status",
      "suggestion_statuses", data.id, before, { ...before, active: data.active });
    return { ok: true };
  });

/* ---------------- Suggestions ---------------- */

export const listSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { includeArchived?: boolean } | undefined) => i ?? {})
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    const db = await admin();
    let q = db.from("suggestions").select("*").order("created_at", { ascending: false }).limit(1000);
    if (!data.includeArchived) q = q.eq("archived", false);
    const [{ data: rows, error }, { data: staff }, { data: statuses }] = await Promise.all([
      q,
      db.from("staff_users").select("id, name, role, status").eq("status", "active").order("name"),
      db.from("suggestion_statuses").select("id, is_final, sort_order, active").order("sort_order"),
    ]);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Suggestion[];
    const finalIds = new Set(((statuses ?? []) as { id: string; is_final: boolean }[]).filter((s) => s.is_final).map((s) => s.id));
    const firstId = ((statuses ?? []) as { id: string; active: boolean }[]).find((s) => s.active)?.id;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const live = list.filter((s) => !s.archived);
    const counts = {
      new: live.filter((s) => s.status_id === firstId).length,
      pending: live.filter((s) => !s.status_id || !finalIds.has(s.status_id)).length,
      finalThisMonth: live.filter(
        (s) => s.status_id && finalIds.has(s.status_id) && s.final_at && new Date(s.final_at) >= monthStart,
      ).length,
    };
    return {
      canEdit: me.canEdit,
      suggestions: list,
      staff: ((staff ?? []) as { id: string; name: string; role: string }[]).map((s) => ({ id: s.id, name: s.name, role: s.role })),
      counts,
    };
  });

export type Remark = {
  id: string;
  remark: string;
  staff_name: string | null;
  old_status_id: string | null;
  new_status_id: string | null;
  created_at: string;
};

export const getSuggestionDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    await staffOf(context.supabase, context.userId);
    const db = await admin();
    const { data: s, error } = await db.from("suggestions").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!s) throw new Error("Suggestion not found");
    const { data: remarks } = await db
      .from("suggestion_remarks")
      .select("id, remark, old_status_id, new_status_id, created_at, staff_users(name)")
      .eq("suggestion_id", data.id)
      .order("created_at", { ascending: false });
    let photoUrl: string | null = null;
    if (s.photo_path) {
      if (/^https?:\/\//.test(s.photo_path)) photoUrl = s.photo_path;
      else {
        const { data: signed } = await db.storage.from("suggestion-media").createSignedUrl(s.photo_path, 3600);
        photoUrl = signed?.signedUrl ?? null;
      }
    }
    return {
      suggestion: s as Suggestion,
      photoUrl,
      remarks: ((remarks ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        remark: r.remark as string,
        old_status_id: (r.old_status_id as string) ?? null,
        new_status_id: (r.new_status_id as string) ?? null,
        created_at: r.created_at as string,
        staff_name: ((r.staff_users as { name?: string } | null)?.name ?? null) as string | null,
      })) as Remark[],
    };
  });

export type ManualSuggestionInput = {
  source: SuggestionSource;
  category: SuggestionCategory;
  text: string;
  name: string | null;
  phone: string | null;
  priority: SuggestionPriority;
  assigned_to: string | null;
};

export const createManualSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: ManualSuggestionInput) => {
    if (!SUGGESTION_SOURCES.includes(i?.source)) throw new Error("Pick a source");
    if (!SUGGESTION_CATEGORIES.includes(i?.category)) throw new Error("Pick a category");
    if (!SUGGESTION_PRIORITIES.includes(i?.priority)) throw new Error("Pick a priority");
    if (!clean(i?.text, 4000)) throw new Error("Suggestion text is required");
    if (i.phone && !/^\+?[0-9 ]{7,15}$/.test(i.phone.trim())) throw new Error("Invalid phone number");
    return i;
  })
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    if (!me.canEdit) throw new Error("Only Super Admin / Ops Manager can add suggestions");
    const db = await admin();
    const { data: first } = await db.from("suggestion_statuses").select("id").eq("active", true).order("sort_order").limit(1);
    const phone = data.phone ? data.phone.replace(/\s+/g, "") : null;
    const { data: row, error } = await db
      .from("suggestions")
      .insert({
        source: data.source,
        category: data.category,
        text: clean(data.text, 4000),
        name: clean(data.name, 120) || null,
        phone,
        priority: data.priority,
        assigned_to: data.assigned_to || null,
        status_id: first?.[0]?.id ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await db.from("suggestion_remarks").insert({
      suggestion_id: row.id,
      staff_id: me.id,
      remark: "Suggestion added manually",
      new_status_id: row.status_id,
    });
    await audit(db, context.userId, "create_suggestion", "suggestions", row.id, null, row);
    return { id: row.id as string };
  });

export const changeSuggestionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; status_id: string; remark: string }) => {
    if (!i?.status_id) throw new Error("Pick a status");
    if (!clean(i?.remark, 1000)) throw new Error("Remark is required");
    return i;
  })
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    if (!me.canEdit) throw new Error("Forbidden");
    const db = await admin();
    const [{ data: before }, { data: status }] = await Promise.all([
      db.from("suggestions").select("*").eq("id", data.id).maybeSingle(),
      db.from("suggestion_statuses").select("*").eq("id", data.status_id).maybeSingle(),
    ]);
    if (!before) throw new Error("Suggestion not found");
    if (!status || !status.active) throw new Error("Status is not active");
    const same = before.status_id === data.status_id;
    let after = before;
    if (!same) {
      const { data: upd, error } = await db
        .from("suggestions")
        .update({ status_id: data.status_id, final_at: status.is_final ? new Date().toISOString() : null })
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      after = upd;
    }
    await db.from("suggestion_remarks").insert({
      suggestion_id: data.id,
      staff_id: me.id,
      remark: clean(data.remark, 1000),
      old_status_id: same ? null : before.status_id,
      new_status_id: same ? null : data.status_id,
    });
    await audit(db, context.userId, same ? "add_suggestion_remark" : "change_suggestion_status", "suggestions", data.id, before, after);

    let notified = false;
    if (!same && status.notify_customer && status.notify_message && before.source === "customer_app" && before.user_id) {
      const { error } = await db.rpc("notify_push_event", {
        _user_type: "customer",
        _user_id: before.user_id,
        _alert_type: "suggestion_update",
        _title: "Badiyos",
        _body: status.notify_message,
        _data: { route: "suggestions", suggestion_id: data.id },
      });
      notified = !error;
    }
    return { ok: true, notified };
  });

export const updateSuggestionMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { id: string; priority?: SuggestionPriority; assigned_to?: string | null; archived?: boolean }) => {
      if (i.priority && !SUGGESTION_PRIORITIES.includes(i.priority)) throw new Error("Invalid priority");
      return i;
    },
  )
  .handler(async ({ data, context }) => {
    const me = await staffOf(context.supabase, context.userId);
    if (!me.canEdit) throw new Error("Forbidden");
    const db = await admin();
    const { data: before } = await db.from("suggestions").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("Suggestion not found");
    const patch: Record<string, unknown> = {};
    if (data.priority) patch.priority = data.priority;
    if (data.assigned_to !== undefined) patch.assigned_to = data.assigned_to || null;
    if (data.archived !== undefined) patch.archived = data.archived;
    const { data: after, error } = await db.from("suggestions").update(patch).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    const bits: string[] = [];
    if (data.priority && data.priority !== before.priority) bits.push(`Priority → ${data.priority}`);
    if (data.assigned_to !== undefined && data.assigned_to !== before.assigned_to) bits.push("Assignee changed");
    if (data.archived !== undefined) bits.push(data.archived ? "Archived" : "Restored");
    if (bits.length)
      await db.from("suggestion_remarks").insert({ suggestion_id: data.id, staff_id: me.id, remark: bits.join(" · ") });
    await audit(db, context.userId, "update_suggestion", "suggestions", data.id, before, after);
    return { ok: true };
  });
