import { describe, expect, it } from "vitest";
import { normalizeCleanMedia, validateCleanMedia } from "./clean-media";

describe("clean_media", () => {
  it("reads old tile_urls as 6 enabled tiles with default titles", () => {
    const m = normalizeCleanMedia({ tile_urls: ["a", "b"] });
    expect(m.tiles).toHaveLength(6);
    expect(m.tiles[0]).toEqual({ url: "a", title_en: "House Cleaning", title_mr: "घराची स्वच्छता", enabled: true });
    expect(m.tiles[2].url).toBeNull();
    expect(m.heading_en).toBe("One Expert who can do it all");
  });
  it("requires exactly 6 tiles", () => {
    const m = normalizeCleanMedia({});
    expect(validateCleanMedia(m)).toBeNull();
    expect(validateCleanMedia({ ...m, tiles: m.tiles.slice(0, 5) })).toBe("Exactly 6 tiles are required");
  });
});
