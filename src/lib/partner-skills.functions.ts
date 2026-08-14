import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SkillStatus = "pending" | "approved" | "rejected";

export type SkillRequestRow = {
  id: string;
  expertId: string;
  expertName: string;
  expertPhone: string;
  categoryId: string;
  categoryName: string;
  status: SkillStatus;
  createdAt: string;
  approvedAt: string | null;
};

export const listPartnerSkillRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: SkillStatus | null } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<SkillRequestRow[]> => {
    const db = context.supabase;
    let q = db
      .from("partner_skills")
      .select("id, expert_id, service_category_id, status, created_at, approved_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (rows ?? []) as any[];
    if (!raw.length) return [];

    const expertIds = Array.from(new Set(raw.map((r) => r.expert_id)));
    const catIds = Array.from(new Set(raw.map((r) => r.service_category_id)));

    const [{ data: experts }, { data: cats }] = await Promise.all([
      db.from("experts").select("id, name, phone").in("id", expertIds),
      db.from("service_categories").select("id, name").in("id", catIds),
    ]);

    const expertMap = new Map(
      ((experts ?? []) as { id: string; name: string; phone: string }[]).map((e) => [e.id, e]),
    );
    const catMap = new Map(
      ((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
    );

    return raw.map((r) => ({
      id: r.id,
      expertId: r.expert_id,
      expertName: expertMap.get(r.expert_id)?.name ?? "—",
      expertPhone: expertMap.get(r.expert_id)?.phone ?? "—",
      categoryId: r.service_category_id,
      categoryName: catMap.get(r.service_category_id) ?? "—",
      status: r.status as SkillStatus,
      createdAt: r.created_at,
      approvedAt: r.approved_at,
    }));
  });

export const listExpertSkills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { expertId: string }) => input)
  .handler(
    async ({
      data,
      context,
    }): Promise<{ id: string; categoryName: string; status: SkillStatus }[]> => {
      const db = context.supabase;
      const { data: rows, error } = await db
        .from("partner_skills")
        .select("id, service_category_id, status")
        .eq("expert_id", data.expertId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (rows ?? []) as any[];
      if (!raw.length) return [];
      const { data: cats } = await db
        .from("service_categories")
        .select("id, name")
        .in("id", Array.from(new Set(raw.map((r) => r.service_category_id))));
      const catMap = new Map(
        ((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
      );
      return raw.map((r) => ({
        id: r.id,
        categoryName: catMap.get(r.service_category_id) ?? "—",
        status: r.status as SkillStatus,
      }));
    },
  );

export const decidePartnerSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { skillId: string; decision: "approved" | "rejected"; notes?: string | null }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_decide_partner_skill", {
      _skill_id: data.skillId,
      _decision: data.decision,
      _notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
