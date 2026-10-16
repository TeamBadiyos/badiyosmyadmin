import { describe, it, expect } from "vitest";
import { deliveryFee, riderGets, commissionToRiderShare } from "./delivery-rate";

const latur = { baseFare: 30, includedKm: 2, perKm: 10, minFare: 30, platformFee: 0, riderSharePct: 70 };

describe("delivery fee", () => {
  it("1 km Store order is ₹30", () => expect(deliveryFee(1, latur)).toBe(30));
  it("3 km Store order is ₹40", () => expect(deliveryFee(3, latur)).toBe(40));
  it("6 km Store order is ₹70", () => expect(deliveryFee(6, latur)).toBe(70));
  it("adds platform fee after min fare", () => expect(deliveryFee(1, { ...latur, platformFee: 5 })).toBe(35));
  it("5 km rider gets ₹42 at 70%", () => { expect(deliveryFee(5, latur)).toBe(60); expect(riderGets(5, latur)).toBe(42); });
  it("Parcel commission 30% = rider share 70%", () => expect(commissionToRiderShare(30)).toBe(70));
});
