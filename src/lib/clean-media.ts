export type CleanTile = { title: string; title_mr: string; url: string | null; enabled: boolean };
export type CleanMedia = { maid_url: string | null; heading: string; heading_mr: string; tiles: CleanTile[] };

export const DEFAULT_TILES: Omit<CleanTile, "url">[] = [
  { title: "House Cleaning", title_mr: "घराची स्वच्छता", enabled: true },
  { title: "Dusting & Wiping", title_mr: "धूळ पुसणे", enabled: true },
  { title: "Bathroom Cleaning", title_mr: "बाथरूम स्वच्छता", enabled: true },
  { title: "Wash Fold & Arrange", title_mr: "कपडे धुणे व घडी", enabled: true },
  { title: "Cleaning Dishes", title_mr: "भांडी घासणे", enabled: true },
  { title: "And many more", title_mr: "आणि बरेच काही", enabled: true },
];

/** Reads the app format, or older saved fields (heading_en, title_en, tile_urls), into exactly 6 app-format tiles (mirrors clean_media_normalize in SQL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCleanMedia(p: any): CleanMedia {
  p = p ?? {};
  const tiles: CleanTile[] = DEFAULT_TILES.map((d, i) => {
    const t = Array.isArray(p.tiles) ? p.tiles[i] : undefined;
    return {
      title: t?.title || t?.title_en || d.title,
      title_mr: t?.title_mr ?? d.title_mr,
      url: t?.url ?? (Array.isArray(p.tile_urls) ? (p.tile_urls[i] ?? null) : null),
      enabled: t?.enabled !== false,
    };
  });
  return {
    maid_url: p.maid_url ?? null,
    heading: p.heading || p.heading_en || "One Expert who can do it all",
    heading_mr: p.heading_mr || "एक एक्सपर्ट, सगळी कामे",
    tiles,
  };
}

export function validateCleanMedia(m: CleanMedia): string | null {
  if (m.tiles.length !== 6) return "Exactly 6 tiles are required";
  if (!m.heading.trim()) return "Heading (English) is required";
  if (m.tiles.some((t) => !t.title.trim())) return "Each tile needs an English title";
  return null;
}
