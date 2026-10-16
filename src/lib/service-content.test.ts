import { describe, expect, it } from "vitest";
import { normalizeServiceContent, validateServiceContent } from "./service-content";

describe("service content", () => {
  it("defaults background colour per service", () => {
    expect(normalizeServiceContent({}, "clean").hero.bg_color).toBe("#00B97A");
    expect(normalizeServiceContent({}, "wash").hero.bg_color).toBe("#222831");
  });
  it("always has 3 cards", () => {
    expect(normalizeServiceContent({ cards: [{ title: "A" }] }, "clean").cards).toHaveLength(3);
  });
  it("blocks original price not above current price", () => {
    const m = normalizeServiceContent({ hero: { subline: "x" }, cards: [{ title: "a" }, { title: "b" }, { title: "c" }], options: { o1: { original_price: 99 } } }, "wash");
    const live = [{ price_option_id: "o1", label: "Bike", price: 99, strikethrough_price: null, gst_rate: 18 }];
    expect(validateServiceContent(m, live)).toMatch(/higher/);
    m.options.o1.original_price = 150;
    expect(validateServiceContent(m, live)).toBeNull();
  });
});

import { badPlaceholder as bp, defaultExtras as de, normalizeServiceContent as nsc, validateServiceContent as vsc } from "./service-content";
describe("banners & campaign", () => {
  it("rejects unknown placeholder", () => { expect(bp("Hi {nam}")).toBe("nam"); expect(bp("{greeting}, {name}")).toBeNull(); });
  it("defaults details note", () => { expect(de("clean").details.note).toBe("Please keep cleaning supplies ready at home"); });
  it("campaign end must be after start", () => {
    const m = nsc({ hero: { subline: "x" }, cards: [{ title: "a" }, { title: "b" }, { title: "c" }] }, "clean");
    m.campaign = { ...m.campaign, enabled: true, title: "Sale", starts_at: "2026-11-02T10:00:00+05:30", ends_at: "2026-11-01T10:00:00+05:30" };
    expect(vsc(m, [])).toBe("Campaign end must be after start");
  });
});

describe("hero card title", () => {
  it("defaults per service", () => {
    expect(nsc({}, "clean").hero.card_title_mr).toBe("मेड");
    expect(nsc({}, "wash").hero.card_title).toBe("Car Wash");
  });
});

describe("morning switch time", () => {
  it("defaults to 05:00", () => { expect(nsc({}, "clean").hero.morning_switch_time).toBe("05:00"); });
});
