import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AuditLogRow = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetTable: string | null;
  targetId: string | null;
  beforeState: unknown;
  afterState: unknown;
  createdAt: string;
};

export type ListAuditLogsInput = {
  page?: number;
  pageSize?: number;
  actorId?: string | null;
  action?: string | null;
  targetTable?: string | null;
  from?: string | null; // ISO date
  to?: string | null; // ISO date
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireSuperAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("staff_users")
    .select("role, status")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "active" || data.role !== "super_admin") {
    throw new Error("Forbidden");
  }
}

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ListAuditLogsInput) => input ?? {})
  .handler(
    async ({
      data,
      context,
    }): Promise<{ rows: AuditLogRow[]; total: number; page: number; pageSize: number }> => {
      await requireSuperAdmin(context.supabase, context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const page = Math.max(1, Number(data.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(data.pageSize ?? 25)));
      const fromIdx = (page - 1) * pageSize;
      const toIdx = fromIdx + pageSize - 1;

      let q = supabaseAdmin
        .from("audit_logs")
        .select("id, actor_id, action, target_table, target_id, before_state, after_state, created_at", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .range(fromIdx, toIdx);

      if (data.actorId) q = q.eq("actor_id", data.actorId);
      if (data.action) q = q.eq("action", data.action);
      if (data.targetTable) q = q.eq("target_table", data.targetTable);
      if (data.from) q = q.gte("created_at", data.from);
      if (data.to) q = q.lte("created_at", data.to);

      const { data: rows, error, count } = await q;
      if (error) throw new Error(error.message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (rows ?? []) as any[];

      const actorIds = Array.from(
        new Set(raw.map((r) => r.actor_id).filter((v): v is string => !!v)),
      );
      const nameByAuthId = new Map<string, string>();
      if (actorIds.length) {
        const { data: staff } = await supabaseAdmin
          .from("staff_users")
          .select("auth_user_id, name")
          .in("auth_user_id", actorIds);
        for (const s of (staff ?? []) as { auth_user_id: string; name: string }[]) {
          nameByAuthId.set(s.auth_user_id, s.name);
        }
      }

      return {
        page,
        pageSize,
        total: count ?? 0,
        rows: raw.map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actorName: r.actor_id ? nameByAuthId.get(r.actor_id) ?? null : null,
          action: r.action,
          targetTable: r.target_table,
          targetId: r.target_id,
          beforeState: r.before_state,
          afterState: r.after_state,
          createdAt: r.created_at,
        })),
      };
    },
  );

export const listAuditFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      actors: { id: string; name: string }[];
      actions: string[];
      tables: string[];
    }> => {
      await requireSuperAdmin(context.supabase, context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [{ data: staff }, { data: logs }] = await Promise.all([
        supabaseAdmin
          .from("staff_users")
          .select("auth_user_id, name")
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("audit_logs")
          .select("action, target_table")
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

      const actions = Array.from(
        new Set(((logs ?? []) as { action: string }[]).map((l) => l.action).filter(Boolean)),
      ).sort();
      const tables = Array.from(
        new Set(
          ((logs ?? []) as { target_table: string | null }[])
            .map((l) => l.target_table)
            .filter((v): v is string => !!v),
        ),
      ).sort();
      const actors = ((staff ?? []) as { auth_user_id: string; name: string }[]).map((s) => ({
        id: s.auth_user_id,
        name: s.name,
      }));

      return { actors, actions, tables };
    },
  );
