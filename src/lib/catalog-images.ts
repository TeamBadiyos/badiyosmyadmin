// Public catalog photos (products, shop photos, category images).
// The database stores only relative paths; URLs are always built from the
// custom domain so a backend region move never breaks stored links.
export const CATALOG_BUCKET = "catalog-images";
export const CATALOG_PUBLIC_BASE =
  "https://api.badiyos.com/storage/v1/object/public/catalog-images";

function clean(path: string) {
  return path
    .replace(/^\/+/, "")
    .replace(/^(catalog-images|product-images|merchant-documents)\//, "");
}

/** Full-size public URL for a stored relative path (full URLs pass through). */
export function catalogImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${CATALOG_PUBLIC_BASE}/${clean(path).split("/").map(encodeURIComponent).join("/")}`;
}

/** Thumbnail URL; callers should fall back to catalogImageUrl on error. */
export function catalogThumbUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return catalogImageUrl(`_thumbs/${clean(path)}.webp`);
}

export function catalogThumbPath(path: string) {
  return `_thumbs/${clean(path)}.webp`;
}
