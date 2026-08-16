import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TaskDetail = {
  id: string;
  segment_id: string;
  task_name: string;
  task_slug: string;
  icon_url: string | null;
  included_items: string[];
  excluded_items: string[];
  rank: number;
  is_active: boolean;
};

const SELECT =
  "id,segment_id,task_name,task_slug,icon_url,included_items,excluded_items,rank,is_active";

export const listTaskDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ segment_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<TaskDetail[]> => {
    const { data: rows, error } = await context.supabase
      .from("service_task_details")
      .select(SELECT)
      .eq("segment_id", data.segment_id)
      .order("rank", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as TaskDetail[];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  segment_id: z.string().uuid(),
  task_name: z.string().trim().min(2).max(120),
  task_slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers or dashes"),
  icon_url: z.string().trim().max(500).optional().nullable(),
  included_items: z.array(z.string().trim().min(1).max(300)).max(60),
  excluded_items: z.array(z.string().trim().min(1).max(300)).max(60),
  is_active: z.boolean(),
});

export const saveTaskDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertSchema.parse(raw))
  .handler(async ({ data, context }): Promise<string> => {
    const { data: id, error } = await context.supabase.rpc("staff_upsert_task_detail", {
      _payload: {
        id: data.id ?? null,
        segment_id: data.segment_id,
        task_name: data.task_name,
        task_slug: data.task_slug,
        icon_url: data.icon_url ?? null,
        included_items: data.included_items,
        excluded_items: data.excluded_items,
        is_active: data.is_active,
      },
    });
    if (error) throw new Error(error.message);
    return id as string;
  });

export const deleteTaskDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_delete_task_detail", { _id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderTaskDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        orders: z.array(z.object({ id: z.string().uuid(), rank: z.number().int() })).max(200),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_reorder_task_details", {
      _orders: data.orders,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
