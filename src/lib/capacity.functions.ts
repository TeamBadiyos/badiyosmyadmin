import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CapacityMessage = {
  id: string;
  message_key: string;
  message_text: string;
  city: string;
  is_active: boolean;
  updated_at: string;
};

export const listCapacityMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CapacityMessage[]> => {
    const { data, error } = await context.supabase
      .from("capacity_messages")
      .select("id,message_key,message_text,city,is_active,updated_at")
      .order("message_key", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as CapacityMessage[];
  });

export const saveCapacityMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        message_key: z.string().trim().min(1).max(60).optional(),
        message_text: z.string().trim().min(1).max(1000).optional(),
        city: z.string().trim().min(1).max(60).optional(),
        is_active: z.boolean().optional(),
        delete: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_save_capacity_message", {
      _payload: {
        ...(data.id ? { id: data.id } : {}),
        ...(data.message_key !== undefined ? { message_key: data.message_key } : {}),
        ...(data.message_text !== undefined ? { message_text: data.message_text } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
        ...(data.delete ? { delete: true } : {}),
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
