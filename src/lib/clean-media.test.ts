import { describe, expect, it } from "vitest";
import { normalizeCleanMedia, validateCleanMedia } from "./clean-media";

describe("clean_media", () => {
  it("reads old tile_urls as 6 enabled tiles with default titles", () => {
    const m = normalizeCleanMedia({ tile_urls: ["a", "b"] });
    expect(m.tiles).toHaveLength(6);
    expect(m.tiles[0]).toEqual({ title: "House Cleaning", title_mr: "घराची स्वच्छता", url: "a", enabled: true });
    expect(m.tiles[2].url).toBeNull();
    expect(m.heading).toBe("One Expert who can do it all");
  });
  it("reads old heading_en/title_en into app fields", () => {
    const m = normalizeCleanMedia({ heading_en: "H", tiles: [{ title_en: "T", url: "u", enabled: false }] });
    expect(m.heading).toBe("H");
    expect(m.tiles[0]).toEqual({ title: "T", title_mr: "घराची स्वच्छता", url: "u", enabled: false });
  });
  it("requires exactly 6 tiles", () => {
    const m = normalizeCleanMedia({});
    expect(validateCleanMedia(m)).toBeNull();
    expect(validateCleanMedia({ ...m, tiles: m.tiles.slice(0, 5) })).toBe("Exactly 6 tiles are required");
  });
});
