import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DeletionRequestStatus = "pending" | "in_progress" | "completed" | "rejected";

export type DeletionRequest = {
  id: string;
  phone: string;
  email: string | null;
  reason: string | null;
  status: DeletionRequestStatus;
  staffNote: string | null;
  handledAt: string | null;
  createdAt: string;
};

const submitSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(7, "Phone number is too short")
    .max(20, "Phone number is too long")
    .regex(/^[+0-9\s\-()]+$/, "Phone number is invalid"),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Invalid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  reason: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Public: anyone can submit a deletion request from the website. */
export const submitAccountDeletionRequest = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => submitSchema.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("account_deletion_requests").insert({
      phone: data.phone,
      email: data.email ?? null,
      reason: data.reason ?? null,
    });
    if (error) throw new Error("Could not submit right now. Please try again.");
    return { ok: true as const };
  });

type Row = {
  id: string;
  phone: string;
  email: string | null;
  reason: string | null;
  status: string;
  staff_note: string | null;
  handled_at: string | null;
  created_at: string;
};

export const listDeletionRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ status: z.string().nullable().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }): Promise<DeletionRequest[]> => {
    let q = context.supabase
      .from("account_deletion_requests")
      .select("id, phone, email, reason, status, staff_note, handled_at, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Row[]).map((r) => ({
      id: r.id,
      phone: r.phone,
      email: r.email,
      reason: r.reason,
      status: r.status as DeletionRequestStatus,
      staffNote: r.staff_note,
      handledAt: r.handled_at,
      createdAt: r.created_at,
    }));
  });

export const updateDeletionRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        status: z.enum(["pending", "in_progress", "completed", "rejected"]),
        note: z.string().max(2000).nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("staff_update_deletion_request", {
      _request_id: data.requestId,
      _status: data.status,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
