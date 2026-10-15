import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DispatchConfig = {
  id: string;
  city: string;
  broadcast_radius_km: number;
  no_accept_alert_threshold_seconds: number;
  no_accept_minutes: Record<string, number> | null;
  aisensy_template_name: string | null;
  ops_alert_whatsapp_numbers: string[];
  almost_available_window_minutes: number;
  accept_timeouts?: { store: number | null; food: number | null };
};

export const getDispatchConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DispatchConfig[]> => {
    const { data, error } = await context.supabase
      .from("dispatch_config")
      .select(
        "id,city,broadcast_radius_km,no_accept_alert_threshold_seconds,no_accept_minutes,aisensy_template_name,ops_alert_whatsapp_numbers,almost_available_window_minutes",
      )
      .order("city", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: ss } = await context.supabase.from("service_settings").select("service_key, default_accept_timeout_minutes").in("service_key", ["store", "food"]);
    const t = (k: string) => ((ss ?? []) as Array<{ service_key: string; default_accept_timeout_minutes: number }>).find((r) => r.service_key === k)?.default_accept_timeout_minutes ?? null;
    return ((data ?? []) as unknown as DispatchConfig[]).map((c) => ({ ...c, accept_timeouts: { store: t("store"), food: t("food") } }));
  });

export const updateDispatchConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        no_accept_minutes: z.record(z.enum(["maid","wash","store","food","parcel"]), z.number().int().min(1).max(60)).optional(),
        aisensy_template_name: z.string().trim().max(200).optional().nullable(),
        ops_alert_whatsapp_numbers: z.array(z.string().trim().min(8).max(20)).max(10).optional(),
        almost_available_window_minutes: z.number().int().min(1).max(120).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_dispatch_config", {
      _payload: {
        id: data.id,
        ...(data.no_accept_minutes !== undefined ? { no_accept_minutes: data.no_accept_minutes } : {}),
        ...(data.aisensy_template_name !== undefined
          ? { aisensy_template_name: data.aisensy_template_name }
          : {}),
        ...(data.ops_alert_whatsapp_numbers !== undefined
          ? { ops_alert_whatsapp_numbers: data.ops_alert_whatsapp_numbers }
          : {}),
        ...(data.almost_available_window_minutes !== undefined
          ? { almost_available_window_minutes: data.almost_available_window_minutes }
          : {}),
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type DispatchAlertEvent = {
  id: string;
  booking_id: string;
  alert_type: "no_accept" | "zero_capacity";
  city: string | null;
  triggered_at: string;
  whatsapp_sent: boolean;
  service_label: string | null;
};

export const listDispatchAlertEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DispatchAlertEvent[]> => {
    const { data, error } = await context.supabase
      .from("dispatch_alert_events")
      .select("id,booking_id,alert_type,city,triggered_at,whatsapp_sent,bookings(service_label)")
      .order("triggered_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      booking_id: r.booking_id as string,
      alert_type: r.alert_type as DispatchAlertEvent["alert_type"],
      city: (r.city as string | null) ?? null,
      triggered_at: r.triggered_at as string,
      whatsapp_sent: Boolean(r.whatsapp_sent),
      service_label:
        ((r.bookings as { service_label?: string } | null)?.service_label as string | null) ?? null,
    }));
  });
