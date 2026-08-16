import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NotificationSound = {
  id: string;
  event_key: string;
  label: string;
  audio_url: string | null;
  applies_to: string[];
  is_active: boolean;
  updated_at: string;
};

export const listNotificationSounds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationSound[]> => {
    const { data, error } = await context.supabase
      .from("notification_sounds")
      .select("id,event_key,label,audio_url,applies_to,is_active,updated_at")
      .order("label", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as NotificationSound[];
  });

export const saveNotificationSound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        audio_url: z.string().trim().max(500).optional().nullable(),
        is_active: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_upsert_notification_sound", {
      _payload: {
        id: data.id,
        ...(data.audio_url !== undefined ? { audio_url: data.audio_url } : {}),
        ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type PendingExtension = {
  id: string;
  booking_id: string;
  extra_minutes: number;
  price: number;
  approval_status: string;
  created_at: string;
  booking: {
    id: string;
    service_label: string;
    status: string;
    scheduled_date: string | null;
    scheduled_time_slot: string | null;
  } | null;
};

export const listPendingExtensions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingExtension[]> => {
    const { data, error } = await context.supabase
      .from("booking_extensions")
      .select(
        "id,booking_id,extra_minutes,price,approval_status,created_at,booking:bookings(id,service_label,status,scheduled_date,scheduled_time_slot)",
      )
      .eq("approval_status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as PendingExtension[];
  });
