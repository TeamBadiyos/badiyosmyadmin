import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DiscountRow = {
  id: string;
  createdAt: string;
  status: string;
  serviceLabel: string;
  customerName: string | null;
  customerPhone: string | null;
  kind: "coupon" | "coins";
  couponCode: string | null;
  gross: number;
  discount: number;
  paid: number;
};

/** Discounted bookings (coupon or coin/free checkout) inside [from, to). */
export const getDiscountBreakdown = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string | null; to?: string | null }) => ({
    from: input?.from ?? null,
    to: input?.to ?? null,
  }))
  .handler(async ({ data, context }): Promise<DiscountRow[]> => {
    const { data: staff, error: staffErr } = await context.supabase
      .from("staff_users")
      .select("id, status")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < 20; page++) {
      let q = context.supabase
        .from("bookings")
        .select(
          "id, created_at, status, service_label, discount_amount, coupon_code, razorpay_payment_id, price, total_amount, user_id, users:user_id(full_name, phone)",
        )
        .or("discount_amount.gt.0,razorpay_payment_id.like.free_*")
        .order("created_at", { ascending: false })
        .range(page * 1000, page * 1000 + 999);
      if (data.from) q = q.gte("created_at", data.from);
      if (data.to) q = q.lt("created_at", data.to);
      const { data: chunk, error } = await q;
      if (error) throw error;
      rows.push(...((chunk ?? []) as Record<string, unknown>[]));
      if (!chunk || chunk.length < 1000) break;
    }

    const out: DiscountRow[] = [];
    for (const r of rows) {
      const status = String(r.status ?? "").toLowerCase();
      if (status === "cancelled" || status === "canceled") continue;
      const pid = String(r.razorpay_payment_id ?? "");
      if (pid.toUpperCase().startsWith("TESTPRICE")) continue;
      const total = Number(r.total_amount ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      const charged = total > 0 ? total : Math.max(0, Number(r.price ?? 0) - discount);
      const isCoin = pid.toLowerCase().startsWith("free_");
      const u = (Array.isArray(r.users) ? r.users[0] : r.users) as
        | { full_name?: string | null; phone?: string | null }
        | null;
      out.push({
        id: String(r.id),
        createdAt: String(r.created_at),
        status,
        serviceLabel: String(r.service_label ?? ""),
        customerName: u?.full_name ?? null,
        customerPhone: u?.phone ?? null,
        kind: isCoin ? "coins" : "coupon",
        couponCode: (r.coupon_code as string | null) ?? null,
        gross: charged + discount,
        discount: isCoin ? charged + discount : discount,
        paid: isCoin ? 0 : charged,
      });
    }
    return out;
  });
