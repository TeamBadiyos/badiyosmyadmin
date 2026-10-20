// Server-only: reads the live pickup/drop OTP of each training courier order's stops.
export type StopOtp = { type: string; otp: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function trainingStopOtps(db: any, courierOrderIds: string[]): Promise<Map<string, StopOtp[]>> {
  const out = new Map<string, StopOtp[]>();
  if (!courierOrderIds.length) return out;
  const { data: stops } = await db
    .from("courier_order_stops")
    .select("id, order_id, stop_type, sequence")
    .in("order_id", courierOrderIds)
    .order("sequence");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (stops ?? []) as any[];
  const otps = await Promise.all(
    rows.map(async (s) => {
      const { data } = await db.rpc("courier_stop_visible_otp", { _stop_id: s.id });
      return (data as string | null) ?? null;
    }),
  );
  rows.forEach((s, i) => {
    const list = out.get(s.order_id) ?? [];
    list.push({ type: String(s.stop_type), otp: otps[i] });
    out.set(s.order_id, list);
  });
  return out;
}
