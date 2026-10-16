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
  it("ignores unused Auto banner and campaign validation while Home still validates", () => {
    const m = nsc({ hero: { subline: "x" }, cards: [{ title: "a" }, { title: "b" }, { title: "c" }] }, "wash");
    m.banner.texts.closed.subline = "Open {unknown}";
    m.campaign = { ...m.campaign, enabled: true, title: "", starts_at: "", ends_at: "" };
    expect(vsc(m, [], "wash")).toBeNull();
    expect(vsc(m, [], "clean")).toMatch(/unknown placeholder/);
  });
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

import { slabError, uncoveredRanges } from "./service-content";
describe("banner slabs", () => {
  const sl = (from: string, to: string) => ({ from, to, label: "", image_url: null, text_color: "light" as const });
  it("rejects overlap", () => { expect(slabError([sl("05:00", "10:00"), sl("09:00", "12:00")])).toMatch(/overlap at 09:00/); });
  it("accepts midnight-crossing slab", () => { expect(slabError([sl("19:00", "05:00"), sl("05:00", "19:00")])).toBeNull(); });
  it("reports gaps", () => { expect(uncoveredRanges([sl("05:00", "19:00"), sl("19:00", "02:00")])).toEqual(["02:00–05:00"]); });
  it("migrates old banners to 4 default slabs", () => {
    const m = nsc({ banners: { closed_morning: { image_url: "https://x/s.webp" }, open_busy: { title: "Old busy" } } }, "clean");
    expect(m.banner.slabs.map((x) => `${x.from}-${x.to}`)).toEqual(["05:00-10:00", "10:00-17:00", "17:00-19:00", "19:00-05:00"]);
    expect(m.banner.slabs[0].image_url).toBe("https://x/s.webp");
    expect(m.banner.texts.open_busy.title).toBe("Old busy");
  });
  it("rejects unknown placeholder in state text", () => {
    const m = nsc({ hero: { subline: "x" }, cards: [{ title: "a" }, { title: "b" }, { title: "c" }] }, "clean");
    m.banner.texts.closed.subline = "Open {time}";
    expect(vsc(m, [])).toMatch(/unknown placeholder \{time\}/);
  });
});
