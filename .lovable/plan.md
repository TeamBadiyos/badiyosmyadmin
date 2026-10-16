# Clean Home → Settings → App content

Staff manage the Clean Home pictures and words shown in the Customer App, one city at a time. A city without its own content uses the default.

## What staff will see

New "App content" tab under Clean Home → Settings (follows the top-bar city; "All cities" edits the default).

- Banner at top: "Editing Latur" or "Editing default (used by cities without their own)". A city with no own content shows the default with a "Customise for this city" button and a "Reset to default" button once customised.
- **Instant card maid photo**: upload / preview / replace / remove. Hint: "PNG with transparent background, 600×750".
- **Section heading**: English + मराठी. Defaults "One Expert who can do it all" / "एक एक्सपर्ट, सगळी कामे".
- **6 tiles**: each has a square photo (hint "500×500"), English + मराठी title, on/off switch, and ▲▼ to reorder. Defaults: House Cleaning, Dusting & Wiping, Bathroom Cleaning, Wash Fold & Arrange, Cleaning Dishes, And many more.
- **Live preview** on the right: phone-sized mock of the Instant card and tile grid, with an EN / मराठी toggle; switched-off tiles are hidden.
- Images are compressed to WebP in the browser before upload. The maid photo keeps transparency. Pictures that are too small or the wrong shape show a warning but can still be saved.
- Save button. Every save, reset and image change goes into the audit log with before/after.

## Saved format (homepage setting "clean_media")

```text
{ maid_url, heading_en, heading_mr,
  tiles: [{ url, title_en, title_mr, enabled }] }   // in display order
```

Old entries that only have `tile_urls` are read as tiles (url from tile_urls, default titles, enabled). On the next save the old `tile_urls` field is kept alongside, filled from the tiles' urls, so older app versions keep working.

## Technical details

- Storage: a `homepage_sections` row with `section_type = 'clean_media'`, `payload` = the format above, `city_id` = city (null = default). No `clean_media` row exists in the database yet; the first save creates it. The Customer App reader was not available to inspect, so the exact key it expects is assumed to be this row; please confirm.
- New audited SECURITY DEFINER RPCs: `staff_get_clean_media(_city uuid)` (returns city row, else default, else built-in defaults, plus `is_default` flag; normalises old `tile_urls`) and `staff_save_clean_media(_city uuid, _payload jsonb)` / `staff_reset_clean_media(_city uuid)`. Super admin / ops manager only, city must be in `staff_allowed_city_ids()`. Payload validated server-side: exactly 6 tiles, required English titles, length limits, https URLs from our storage only.
- Public read for the app: `app_clean_media(_city uuid)` returning the same resolved payload (city → default), executable by anon/authenticated.
- Images: uploaded to the existing public `catalog-images` bucket under `clean-media/<city|default>/…webp` using the existing browser image prep (`src/lib/catalog-image-prep.ts`) with WebP output; removing a picture clears the url (old files left in storage).
- UI: new `src/components/clean-app-content.tsx`, wired into the Clean Home settings tabs; server wrappers in `src/lib/homepage.functions.ts`.
- Small test for the old-format reader (`tile_urls` → tiles) and the 6-tile validation.
