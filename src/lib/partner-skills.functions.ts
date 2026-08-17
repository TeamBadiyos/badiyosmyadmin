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
    }): Promise<
      {
        id: string;
        categoryId: string;
        categoryName: string;
        status: SkillStatus;
        approvedByName: string | null;
        approvedAt: string | null;
      }[]
    > => {
      const db = context.supabase;
      const { data: rows, error } = await db
        .from("partner_skills")
        .select("id, service_category_id, status, approved_by, approved_at")
        .eq("expert_id", data.expertId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (rows ?? []) as any[];
      if (!raw.length) return [];
      const staffIds = Array.from(new Set(raw.map((r) => r.approved_by).filter(Boolean)));
      const [{ data: cats }, staffRes] = await Promise.all([
        db
          .from("service_categories")
          .select("id, name")
          .in("id", Array.from(new Set(raw.map((r) => r.service_category_id)))),
        staffIds.length
          ? db.from("staff_users").select("id, name").in("id", staffIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const catMap = new Map(
        ((cats ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
      );
      const staffMap = new Map(
        (((staffRes as { data: { id: string; name: string }[] | null }).data ?? [])).map((s) => [
          s.id,
          s.name,
        ]),
      );
      return raw.map((r) => ({
        id: r.id,
        categoryId: r.service_category_id,
        categoryName: catMap.get(r.service_category_id) ?? "—",
        status: r.status as SkillStatus,
        approvedByName: r.approved_by ? staffMap.get(r.approved_by) ?? null : null,
        approvedAt: r.approved_at ?? null,
      }));
    },
  );

export const listActiveServiceCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ id: string; name: string }[]> => {
    const { data, error } = await context.supabase
      .from("service_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("rank", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string }[];
  });

export const assignPartnerSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { expertId: string; serviceCategoryId: string }) => {
    if (!input?.expertId || !input?.serviceCategoryId) throw new Error("Missing input");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: id, error } = await context.supabase.rpc("staff_assign_partner_skill", {
      _expert_id: data.expertId,
      _service_category_id: data.serviceCategoryId,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });


export const decidePartnerSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { skillId: string; decision: "approved" | "rejected"; notes?: string | null }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("staff_decide_partner_skill", {
      _skill_id: data.skillId,
      _decision: data.decision,
      _notes: data.notes ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
