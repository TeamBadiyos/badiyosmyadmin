import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HandoverRow = {
  id: string;
  previousExpertName: string | null;
  newExpertName: string | null;
  minutesWorked: number;
  previousPayout: number;
  reason: string;
  createdAt: string;
};

export const getHandoverInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bookingId: string }) => {
    if (!input?.bookingId) throw new Error("bookingId required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: total, error: tErr } = await db.rpc("booking_total_expert_payout", {
      _booking_id: data.bookingId,
    });
    if (tErr) throw new Error(tErr.message);
    const { data: rows, error } = await db
      .from("booking_expert_handovers")
      .select("id, previous_expert_id, new_expert_id, minutes_worked, previous_expert_payout, reason, created_at")
      .eq("booking_id", data.bookingId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    const ids = Array.from(new Set(list.flatMap((r) => [r.previous_expert_id, r.new_expert_id])));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: ex } = await db.from("experts").select("id, name").in("id", ids);
      for (const e of (ex ?? []) as any[]) names.set(e.id, e.name);
    }
    const history: HandoverRow[] = list.map((r) => ({
      id: r.id,
      previousExpertName: names.get(r.previous_expert_id) ?? null,
      newExpertName: names.get(r.new_expert_id) ?? null,
      minutesWorked: Number(r.minutes_worked ?? 0),
      previousPayout: Number(r.previous_expert_payout ?? 0),
      reason: r.reason,
      createdAt: r.created_at,
    }));
    const paid = history.reduce((s, h) => s + h.previousPayout, 0);
    const totalPayout = Number(total ?? 0);
    return { totalPayout, alreadyPaid: paid, remaining: Math.max(totalPayout - paid, 0), history };
  });

export const handoverBookingExpert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { bookingId: string; newExpertId: string; previousPayout: number; reason: string }) => {
      if (!input?.bookingId || !input?.newExpertId) throw new Error("Booking and expert required");
      if (!(input.previousPayout >= 0)) throw new Error("Invalid amount");
      if (!input.reason || input.reason.trim().length < 3) throw new Error("Reason is required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as any).rpc("staff_handover_booking_expert", {
      _booking_id: data.bookingId,
      _new_expert_id: data.newExpertId,
      _previous_payout: Math.round(data.previousPayout),
      _reason: data.reason.trim(),
    });
    if (error) throw new Error(error.message);
    return res as { previous_payout: number; remaining_payout: number };
  });
