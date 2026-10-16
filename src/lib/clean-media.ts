export type CleanTile = { url: string | null; title_en: string; title_mr: string; enabled: boolean };
export type CleanMedia = { maid_url: string | null; heading_en: string; heading_mr: string; tiles: CleanTile[] };

export const DEFAULT_TILES: Omit<CleanTile, "url">[] = [
  { title_en: "House Cleaning", title_mr: "घराची स्वच्छता", enabled: true },
  { title_en: "Dusting & Wiping", title_mr: "धूळ पुसणे", enabled: true },
  { title_en: "Bathroom Cleaning", title_mr: "बाथरूम स्वच्छता", enabled: true },
  { title_en: "Wash Fold & Arrange", title_mr: "कपडे धुणे व घडी", enabled: true },
  { title_en: "Cleaning Dishes", title_mr: "भांडी घासणे", enabled: true },
  { title_en: "And many more", title_mr: "आणि बरेच काही", enabled: true },
];

/** Reads the new format, or the old `tile_urls` list, into the new format (mirrors clean_media_normalize in SQL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCleanMedia(p: any): CleanMedia {
  p = p ?? {};
  const tiles: CleanTile[] =
    Array.isArray(p.tiles) && p.tiles.length
      ? p.tiles.map((t: CleanTile) => ({ url: t.url ?? null, title_en: t.title_en ?? "", title_mr: t.title_mr ?? "", enabled: t.enabled !== false }))
      : DEFAULT_TILES.map((d, i) => ({ ...d, url: Array.isArray(p.tile_urls) ? (p.tile_urls[i] ?? null) : null }));
  return {
    maid_url: p.maid_url ?? null,
    heading_en: p.heading_en || "One Expert who can do it all",
    heading_mr: p.heading_mr || "एक एक्सपर्ट, सगळी कामे",
    tiles,
  };
}

export function validateCleanMedia(m: CleanMedia): string | null {
  if (m.tiles.length !== 6) return "Exactly 6 tiles are required";
  if (!m.heading_en.trim()) return "Heading (English) is required";
  if (m.tiles.some((t) => !t.title_en.trim())) return "Each tile needs an English title";
  return null;
}
