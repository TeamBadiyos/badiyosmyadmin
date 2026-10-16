/** Shared delivery fee formula for Store, Food and Parcel (mirrors SQL delivery_fee_calc). */
export type DeliveryRate = { baseFare: number; includedKm: number; perKm: number; minFare: number; platformFee: number; riderSharePct: number };

export function deliveryFee(km: number, r: DeliveryRate): number {
  const fare = Math.max(r.minFare || 0, (r.baseFare || 0) + Math.max(0, km - (r.includedKm || 0)) * (r.perKm || 0)) + (r.platformFee || 0);
  return Math.round(fare * 100) / 100;
}

export function riderGets(km: number, r: DeliveryRate): number {
  return Math.round(deliveryFee(km, r) * (r.riderSharePct || 0)) / 100;
}

/** Parcel stores commission %; the UI shows rider share %. */
export const commissionToRiderShare = (c: number) => 100 - (Number(c) || 0);
export const riderShareToCommission = (s: number) => 100 - (Number(s) || 0);

export function exampleLine(km: number, r: DeliveryRate): string {
  const extra = Math.max(0, km - (r.includedKm || 0));
  const fee = deliveryFee(km, r);
  const pf = r.platformFee ? ` + ₹${r.platformFee} platform` : "";
  const minNote = fee - (r.platformFee || 0) === (r.minFare || 0) && (r.baseFare || 0) + extra * (r.perKm || 0) < (r.minFare || 0) ? " (min fare)" : "";
  return `${km} km → ₹${r.baseFare || 0} + ${extra} × ₹${r.perKm || 0}${pf} = ₹${fee}${minNote} · rider gets ₹${riderGets(km, r)}`;
}
