import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CommerceStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed";

export type CommerceOrder = {
  id: string;
  orderNumber: string;
  status: CommerceStatus;
  merchantName: string;
  totalAmount: number;
  createdAt: string;
};

export type CommercePipeline = {
  orders: CommerceOrder[];
  offlineToday: { count: number; revenue: number };
};

export const listCommercePipeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { segmentId?: string | null }) => ({
    segmentId: input?.segmentId ?? null,
  }))
  .handler(async ({ data, context }): Promise<CommercePipeline> => {
    const db = context.supabase;

    const { data: staff, error: staffErr } = await db
      .from("staff_users")
      .select("id, status, role")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (staffErr) throw new Error(staffErr.message);
    if (!staff || staff.status !== "active") throw new Error("Forbidden");

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();

    let merchantIds: string[] | null = null;
    if (data.segmentId) {
      const { data: ms, error } = await db
        .from("merchants")
        .select("id")
        .eq("segment_id", data.segmentId);
      if (error) throw new Error(error.message);
      merchantIds = (ms ?? []).map((m) => m.id as string);
      if (merchantIds.length === 0) {
        return { orders: [], offlineToday: { count: 0, revenue: 0 } };
      }
    }

    const cols =
      "id, order_number, status, merchant_id, total_amount, created_at";

    let openQ = db
      .from("merchant_orders")
      .select(cols)
      .in("status", ["pending", "accepted", "preparing", "ready"])
      .order("created_at", { ascending: false })
      .limit(200);
    let doneQ = db
      .from("merchant_orders")
      .select(cols)
      .eq("status", "completed")
      .gte("created_at", startOfDay)
      .order("created_at", { ascending: false })
      .limit(200);
    let offlineQ = db
      .from("offline_sales")
      .select("total_amount")
      .gte("created_at", startOfDay)
      .limit(1000);

    if (merchantIds) {
      openQ = openQ.in("merchant_id", merchantIds);
      doneQ = doneQ.in("merchant_id", merchantIds);
      offlineQ = offlineQ.in("merchant_id", merchantIds);
    }

    const [openRes, doneRes, offlineRes] = await Promise.all([
      openQ,
      doneQ,
      offlineQ,
    ]);
    if (openRes.error) throw new Error(openRes.error.message);
    if (doneRes.error) throw new Error(doneRes.error.message);
    if (offlineRes.error) throw new Error(offlineRes.error.message);

    const rows = [...(openRes.data ?? []), ...(doneRes.data ?? [])];

    const ids = Array.from(
      new Set(rows.map((r) => r.merchant_id as string).filter(Boolean)),
    );
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: ms, error } = await db
        .from("merchants")
        .select("id, store_name")
        .in("id", ids);
      if (error) throw new Error(error.message);
      for (const m of ms ?? []) {
        nameMap.set(m.id as string, (m.store_name as string | null) ?? "Store");
      }
    }

    const offlineRows = offlineRes.data ?? [];

    return {
      orders: rows.map((r) => ({
        id: r.id as string,
        orderNumber: (r.order_number as string) ?? "",
        status: r.status as CommerceStatus,
        merchantName: nameMap.get(r.merchant_id as string) ?? "Store",
        totalAmount: Number(r.total_amount ?? 0),
        createdAt: r.created_at as string,
      })),
      offlineToday: {
        count: offlineRows.length,
        revenue: offlineRows.reduce(
          (s, r) => s + Number(r.total_amount ?? 0),
          0,
        ),
      },
    };
  });
