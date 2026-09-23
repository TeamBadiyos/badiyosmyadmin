import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
};

async function requireStaffRead(context: Ctx) {
  const { data, error } = await context.supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active") throw new Error("Forbidden");
  if (data.role !== "super_admin" && data.role !== "ops_manager") throw new Error("Forbidden");
  return { role: data.role as "super_admin" | "ops_manager", canWrite: data.role === "super_admin" };
}

async function requireStaffWrite(context: Ctx) {
  const access = await requireStaffRead(context);
  if (!access.canWrite) throw new Error("Only a super admin can change service settings");
  return access;
}

export type ServiceFlagControl = {
  id: string;
  service_key: string;
  city: string;
  label: string | null;
  is_active: boolean;
  sort_order: number;
  status: string;
  status_message_en: string | null;
  status_message_mr: string | null;
  resume_at: string | null;
  hours_enabled: boolean;
  last_order_buffer_minutes: number;
  closed_today_date: string | null;
  closed_today_reason: string | null;
  closed_until: string | null;
  updated_at: string;
  status_updated_at: string | null;
};

export type ServiceHourRow = {
  id: string;
  service_flag_id: string;
  weekday: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
  updated_at: string;
};

export type ServiceHolidayRow = {
  id: string;
  service_flag_id: string | null;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  reason_mr: string | null;
};

export type FocusSnapshot = {
  undo_token: string;
  expires_at: string;
  created_at: string;
};

export const listServiceControl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      canWrite: boolean;
      flags: ServiceFlagControl[];
      hours: ServiceHourRow[];
      holidays: ServiceHolidayRow[];
      undo: FocusSnapshot | null;
    }> => {
      const access = await requireStaffRead(context);
      const db = context.supabase;

      const [flagsRes, hoursRes, holRes] = await Promise.all([
        db
          .from("service_flags")
          .select(
            "id, service_key, city, label, is_active, sort_order, status, status_message_en, status_message_mr, resume_at, hours_enabled, last_order_buffer_minutes, closed_today_date, closed_today_reason, closed_until, updated_at, status_updated_at",
          )
          .order("city", { ascending: true })
          .order("sort_order", { ascending: true }),
        db.from("service_hours").select("id, service_flag_id, weekday, open_time, close_time, is_closed, updated_at"),
        db
          .from("service_holidays")
          .select("id, service_flag_id, start_date, end_date, reason, reason_mr")
          .order("start_date", { ascending: true }),
      ]);
      if (flagsRes.error) throw new Error(flagsRes.error.message);
      if (hoursRes.error) throw new Error(hoursRes.error.message);
      if (holRes.error) throw new Error(holRes.error.message);

      let undo: FocusSnapshot | null = null;
      try {
        const { data: snap } = await db
          .from("service_focus_snapshots")
          .select("undo_token, expires_at, created_at")
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (snap) undo = snap as FocusSnapshot;
      } catch {
        undo = null; // RLS may hide snapshots; undo simply won't be offered
      }

      return {
        canWrite: access.canWrite,
        flags: (flagsRes.data ?? []) as ServiceFlagControl[],
        hours: (hoursRes.data ?? []) as ServiceHourRow[],
        holidays: (holRes.data ?? []) as ServiceHolidayRow[],
        undo,
      };
    },
  );

/** Reject the save if someone else edited this flag after `knownUpdatedAt`. */
async function guardConcurrentEdit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  serviceKey: string,
  knownUpdatedAt: string | null,
) {
  if (!knownUpdatedAt) return;
  const { data, error } = await db
    .from("service_flags")
    .select("updated_at, status_updated_at")
    .eq("service_key", serviceKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const current = (data?.status_updated_at as string | null) ?? (data?.updated_at as string | null);
  if (current && knownUpdatedAt && current !== knownUpdatedAt) {
    throw new Error("Kisi ne abhi is service ko badla hai — refresh karke dobara dekhiye.");
  }
}

export const setServiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      serviceKey: string;
      status: string;
      messageEn?: string | null;
      messageMr?: string | null;
      resumeAt?: string | null;
      knownUpdatedAt?: string | null;
    }) => {
      if (!input?.serviceKey || !input?.status) throw new Error("serviceKey and status required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    await guardConcurrentEdit(context.supabase, data.serviceKey, data.knownUpdatedAt ?? null);
    const { data: out, error } = await context.supabase.rpc("staff_set_service_status", {
      _service_key: data.serviceKey,
      _status: data.status,
      _message_en: data.messageEn ?? null,
      _message_mr: data.messageMr ?? null,
      _resume_at: data.resumeAt ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, result: out };
  });

export const applyServiceFocus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { liveServiceKey: string; othersStatus?: string; messageEn?: string; messageMr?: string }) => {
      if (!input?.liveServiceKey) throw new Error("liveServiceKey required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { data: out, error } = await context.supabase.rpc("staff_set_service_focus", {
      _live_service_key: data.liveServiceKey,
      _others_status: data.othersStatus ?? "coming_soon",
      _message_en: data.messageEn || undefined,
      _message_mr: data.messageMr || undefined,
    });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (out ?? {}) as any;
    return {
      ok: true as const,
      undoToken: (j.undo_token as string | undefined) ?? null,
      expiresAt: (j.expires_at as string | undefined) ?? null,
    };
  });

export const undoServiceFocus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { undoToken: string }) => {
    if (!input?.undoToken) throw new Error("undoToken required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { data: out, error } = await context.supabase.rpc("staff_undo_service_focus", {
      _undo_token: data.undoToken,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, result: out };
  });

export const saveServiceHours = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      serviceKey: string;
      rows: { weekday: number; openTime: string; closeTime: string; isClosed: boolean }[];
      knownUpdatedAt?: string | null;
    }) => {
      if (!input?.serviceKey || !Array.isArray(input.rows)) throw new Error("serviceKey and rows required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    await guardConcurrentEdit(context.supabase, data.serviceKey, data.knownUpdatedAt ?? null);
    for (const r of data.rows) {
      if (!r.isClosed && r.closeTime <= r.openTime) {
        throw new Error("Close time must be after open time (weekday " + r.weekday + ")");
      }
    }
    for (const r of data.rows) {
      const { error } = await context.supabase.rpc("staff_set_service_hours", {
        _service_key: data.serviceKey,
        _weekday: r.weekday,
        _open_time: r.openTime,
        _close_time: r.closeTime,
        _is_closed: r.isClosed,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const setServiceHoursEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { serviceKey: string; enabled: boolean }) => {
    if (!input?.serviceKey) throw new Error("serviceKey required");
    return { serviceKey: input.serviceKey, enabled: !!input.enabled };
  })
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { error } = await context.supabase.rpc("staff_set_service_hours_enabled", {
      _service_key: data.serviceKey,
      _enabled: data.enabled,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const addServiceHoliday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { serviceKey: string; startDate: string; endDate?: string | null; reason?: string; reasonMr?: string }) => {
      if (!input?.serviceKey || !input?.startDate) throw new Error("serviceKey and startDate required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { data: out, error } = await context.supabase.rpc("staff_set_service_holiday", {
      _service_key: data.serviceKey,
      _start_date: data.startDate,
      _end_date: data.endDate || undefined,
      _reason: data.reason || undefined,
      _reason_mr: data.reasonMr || undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, result: out };
  });

/** Edit = remove old + add new (the staff RPC has no id-based update). */
export const editServiceHoliday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      holidayId: string;
      serviceKey: string;
      startDate: string;
      endDate?: string | null;
      reason?: string;
      reasonMr?: string;
    }) => {
      if (!input?.holidayId || !input?.serviceKey || !input?.startDate) throw new Error("missing fields");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { error: delErr } = await context.supabase.rpc("staff_remove_service_holiday", {
      _holiday_id: data.holidayId,
    });
    if (delErr) throw new Error(delErr.message);
    const { error } = await context.supabase.rpc("staff_set_service_holiday", {
      _service_key: data.serviceKey,
      _start_date: data.startDate,
      _end_date: data.endDate || undefined,
      _reason: data.reason || undefined,
      _reason_mr: data.reasonMr || undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removeServiceHoliday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { holidayId: string }) => {
    if (!input?.holidayId) throw new Error("holidayId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { error } = await context.supabase.rpc("staff_remove_service_holiday", {
      _holiday_id: data.holidayId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const closeServiceToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { serviceKey: string; reason?: string; until?: string | null }) => {
    if (!input?.serviceKey) throw new Error("serviceKey required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { error } = await context.supabase.rpc("staff_close_service_today", {
      _service_key: data.serviceKey,
      _reason: data.reason || undefined,
      _until: data.until ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const reopenServiceToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { serviceKey: string }) => {
    if (!input?.serviceKey) throw new Error("serviceKey required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaffWrite(context);
    const { error } = await context.supabase.rpc("staff_reopen_service_today", {
      _service_key: data.serviceKey,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type ServicePreviewRow = {
  serviceKey: string;
  label: string;
  city: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: Record<string, any> | null;
  error: string | null;
};

export const getServicePreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { at?: string | null }) => input ?? {})
  .handler(async ({ data, context }): Promise<ServicePreviewRow[]> => {
    await requireStaffRead(context);
    const db = context.supabase;
    const { data: flags, error } = await db
      .from("service_flags")
      .select("service_key, city, label")
      .order("city", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    const at = data.at ?? new Date().toISOString();
    const rows: ServicePreviewRow[] = [];
    for (const f of (flags ?? []) as { service_key: string; city: string; label: string | null }[]) {
      const { data: st, error: sErr } = await db.rpc("service_effective_state", {
        _service_key: f.service_key,
        _city: f.city,
        _at: at,
      });
      rows.push({
        serviceKey: f.service_key,
        label: f.label ?? f.service_key,
        city: f.city,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state: sErr ? null : ((st ?? null) as Record<string, any> | null),
        error: sErr ? sErr.message : null,
      });
    }
    return rows;
  });
