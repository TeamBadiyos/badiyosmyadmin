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
