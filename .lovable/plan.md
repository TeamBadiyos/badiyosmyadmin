# App content for Clean Home and Clean Auto (per city, default fallback)

One "App content" tab in Clean Home → Settings and in Clean Auto → Settings. Both use the same editor and differ only by service. It follows the top-bar city and has a City / Default switch. A city without its own content shows the default, with "Reset to default" once customised. Every text has English and मराठी fields. Photos are compressed to WebP in the browser, and every save, reset and upload is written to the audit log with before/after.

## 1. Hero card
- Heading: optional. If left blank, the app hides it.
- Sub-line. Defaults: Maid "Maid for Your Everyday Needs" / "रोजच्या घरकामासाठी मावशी"; Wash "A Wash for Every Ride" / "प्रत्येक गाडीसाठी वॉश".
- Button text. Default "Book Now" / "बुक करा".
- Photo: transparent PNG, saved as WebP with transparency kept.
- Background colour, picked with a colour picker and a hex field. Defaults: Maid #00B97A, Wash #222831.

## 2. Three cards under the hero
- Each card has a square photo, a title, an "Included" list, a "Not included" list (add, remove and reorder lines, each line in EN and मराठी), an on/off switch and ▲▼ order.
- Wash: each card is linked to one price option (Bike / Car / Combo) through a dropdown, so the app can open the right option.

## 3. Price options
- One row per active price option for the service in that city. Maid shows up to 6 durations; Wash shows Bike, Car and Combo.
- Each row has an image, a display name (EN and मराठी) and an original price (shown struck through in the app; leave it blank for no strike).
- Current price is shown read-only, taken from the city's price list. It is never edited here.
- The original price must be higher than the current price, or the save is blocked.

## Live phone preview
A phone mock on the right shows the hero, the 3 cards and the price options, with an EN / मराठी toggle. Cards that are switched off are hidden.

## Public function for the apps
`app_service_content(_service_key text, _city_id uuid)` where `_service_key` is `'clean'` or `'wash'`. Anyone can call it (anon or logged in). It resolves the city's own content, then the default, then built-in defaults, and returns:

```text
{
  service_key: "clean" | "wash",
  city_id: uuid | null,
  is_default: boolean,
  hero: {
    heading: string|null, heading_mr: string|null,   // null/blank = hide
    subline: string, subline_mr: string,
    button: string, button_mr: string,
    image_url: string|null,
    bg_color: "#00B97A"
  },
  cards: [                                          // 3, in display order, enabled only
    { title, title_mr, image_url,
      included: [{ en, mr }], not_included: [{ en, mr }],
      price_option_id: uuid|null }                  // set for wash
  ],
  options: [                                        // active options, in display order
    { price_option_id: uuid, name, name_mr, image_url,
      original_price: number|null,                  // rupees, struck through
      price: number,                                // live price from the price list, rupees
      gst_rate: number }
  ]
}
```

Prices are in rupees. `price` is always read live, so changing the price list updates the app straight away.

## Technical details
- Storage: `homepage_sections` rows with `section_type` `clean_content` / `wash_content` and `city_id` (null = default). The JSON holds only the editable content; prices come from `city_price_options` when the function is read.
- Per-option extras (image, name, name_mr, original price) are saved inside the content JSON, keyed by `price_option_id`. Options that no longer exist are dropped when the function is read.
- Staff RPCs: `staff_get_service_content`, `staff_save_service_content` and `staff_reset_service_content`, each taking `(_service_key, _city, ...)`. They are SECURITY DEFINER and limited to super_admin / ops_manager. The city must be in `staff_allowed_city_ids()`. Every save, reset and upload is audited.
- Server-side checks: exactly 3 cards, hex colour format, length limits, at most 6 maid options, https image URLs from our storage, and original price higher than current price.
- Images go to `catalog-images/service-content/<service>/<city|default>/…webp` using the existing upload server function, generalised by service.
- UI: new `src/components/service-app-content.tsx`, used in both Settings tabs, with logic in `src/lib/service-content.ts` plus tests (defaults, fallback, validation).
- The existing `clean_media` editor and `app_clean_media` stay as they are, so the current Customer App keeps working until it switches to the new function.
