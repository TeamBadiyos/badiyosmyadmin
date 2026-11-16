import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateOverrideReason, type OverrideAction } from "./courier-overrides";

export type CourierOverride = { id: string; order_id: string; stop_id: string | null; action: string; reason: string; note: string | null; staff_name: string; created_at: string; undone_at: string | null; photo_path: string | null };
export const getCourierOverrides = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { orderId: string }) => i)
  .handler(async ({ data, context }): Promise<CourierOverride[]> => {
    const { data: rows, error } = await context.supabase.from("courier_staff_overrides")
      .select("id,order_id,stop_id,action,reason,note,staff_name,created_at,undone_at,photo_path").eq("order_id", data.orderId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const applyCourierOverride = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { orderId: string; action: OverrideAction; reason: string; note?: string; stopId?: string; expertId?: string; nextStatus?: string; photoPath?: string; returnDistances?: Record<string, number> }) => {
    if (!i.orderId) throw new Error("Order required"); validateOverrideReason(i.reason, i.note); return i;
  }).handler(async ({ data, context }) => {
    const { data: staff, error: staffError } = await context.supabase.from("staff_users").select("role,status").eq("auth_user_id", context.userId).maybeSingle();
    if (staffError || !staff || staff.status !== "active" || !["super_admin", "ops_manager"].includes(staff.role)) throw new Error("Forbidden");
    // The user-scoped read checks city visibility before any privileged access.
    const { data: order, error: orderError } = await context.supabase.from("courier_orders").select("id").eq("id", data.orderId).maybeSingle();
    if (orderError || !order) throw new Error("Order not available in your city scope");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("staff_courier_override", {
      _order_id: data.orderId, _action: data.action, _reason: data.reason, _note: data.note,
      _stop_id: data.stopId, _expert_id: data.expertId, _next_status: data.nextStatus,
      _photo_path: data.photoPath, _return_distances: data.returnDistances, _staff_id: context.userId,
    });
    if (error) throw new Error(error.message); return result;
  });

export const uploadCourierOverridePhoto = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: FormData) => { if (!(i instanceof FormData)) throw new Error("Photo required"); return i; })
  .handler(async ({ data, context }) => {
    const orderId = String(data.get("orderId") ?? ""); const file = data.get("photo");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Choose a JPG, PNG or WebP photo under 5 MB");
    const { data: staff } = await context.supabase.from("staff_users").select("role,status").eq("auth_user_id", context.userId).maybeSingle();
    if (!staff || staff.status !== "active" || !["super_admin", "ops_manager"].includes(staff.role)) throw new Error("Forbidden");
    const { data: order } = await context.supabase.from("courier_orders").select("id").eq("id", orderId).maybeSingle();
    if (!order) throw new Error("Order not available");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `staff-overrides/${orderId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
    const { error } = await supabaseAdmin.storage.from("courier-proofs").upload(path, await file.arrayBuffer(), { contentType: file.type });
    if (error) throw new Error("Photo upload failed");
    return { path };
  });

export const viewCourierOverridePhoto = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i: { overrideId: string }) => i).handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("courier_staff_overrides").select("photo_path").eq("id", data.overrideId).maybeSingle();
    if (error || !row?.photo_path) throw new Error("Photo not available");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage.from("courier-proofs").createSignedUrl(row.photo_path, 300);
    if (signError || !signed) throw new Error("Photo not available"); return { url: signed.signedUrl };
  });