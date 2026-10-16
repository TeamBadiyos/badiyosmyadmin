# Customer App backend: GST per service, separate Clean / Wash settings, clean_media format

## 1. GST per service at booking time

**Found:** every booking takes one global rate — `get_gst_percent()` reads `ops_settings.gst_percent` (falls back to 5) inside the `bookings_before_insert` trigger. Tax Settings already has the right per-service rates (`maid_gst` 5%, `wash_gst` 18%) but booking creation never reads them. Result: all 11 past Car/Bike Wash bookings were charged 5%.

**Fix (server-side only):**
- New `booking_gst_percent(_category_id)`: Car/Bike Wash category → `tax_settings.wash_gst`; Home Cleaning / Festival Special Cleaning → `tax_settings.maid_gst`. An inactive or missing rate stops the booking with a clear error, so a wrong default is never used silently.
- `bookings_before_insert` uses it instead of the global rate. Totals keep the existing rounding in `bookings_finalize_amounts`.
- New public quote function `app_booking_quote(_price_option_id uuid, _city_id uuid)` → `{ price, gst_rate, gst_amount, total }`, using the city's price from `city_price_options` and the same rate and rounding as booking creation, so quote and charge always match.
- **Report only, nothing changed:** after the fix, list every past Car/Bike Wash booking charged 5% with booking no., date, amount, GST charged, GST due at 18% and the difference. 11 such bookings exist today.

## 2. Where each service's settings live (per city)

Service keys: **`clean`** = Clean Home (maid), **`wash`** = Car & Bike Wash.

| Setting | Storage | Clean | Wash |
|---|---|---|---|
| Hours | `service_flags` (service_key, city_id) → `service_hours` (weekday open/close) + `service_holidays` | row exists | row exists |
| Book Now on/off | `city_ops_settings` key | `instant_booking_enabled` | `wash_instant_booking_enabled` |
| Auto-cancel minutes | `city_ops_settings` key | `clean_auto_cancel_minutes` | `wash_auto_cancel_minutes` |
| Slot capacity | `city_ops_settings` default + `service_daily_capacity` per date | `default_slot_capacity` | `wash_default_slot_capacity` |
| Date overrides / Mark full | `service_slot_overrides` (service_key, slot_date, start time, status `fully_booked`) | used | none saved yet |

Why the app only finds "clean": Book Now and capacity use unprefixed keys for Clean and `wash_`-prefixed keys for Wash, so a reader that doesn't pass the service only ever gets Clean's values. Existing functions also mix public and staff-only access (`service_slot_allowed` and `instant_slot_full` can't be called by the app).

**New public read functions, all with `_service_key` = `'clean'` or `'wash'` (anything else is rejected):**
- `app_service_hours(_service_key, _city_id)` → status, weekly hours, holidays, open now.
- `app_book_now_allowed(_service_key, _city_id)` → `{ allowed, reason }`: Book Now switch, open hours and current half-hour slot capacity / Mark full (same rule used at booking).
- `app_auto_cancel_minutes(_service_key, _city_id)` (exists; checked and kept).
- `app_fully_booked_slots(_service_key, _city_id, _from, _to)` → full slots, using `list_fully_booked_slots`.
- Each returns only settings, no personal data. Tested for both keys in Latur.

## 3. clean_media exact app format

Switch the Clean "App content" editor and its save/read functions to exactly:

```text
{ maid_url, heading, heading_mr,
  tiles: [{ title, title_mr, url, enabled }] }   // 6 tiles, in order
```

- Old saved fields (`heading_en`, `title_en`, `tile_urls`) are still read and converted, then dropped on the next save.
- Server validation and the existing test are updated to the new field names.

## Technical details

- One migration: `booking_gst_percent`, updated `bookings_before_insert`, `app_booking_quote`, `app_service_hours`, `app_book_now_allowed`, `app_fully_booked_slots`, updated `clean_media_normalize` / `staff_save_clean_media`. Public functions are granted to anon/authenticated, staff ones stay staff-only.
- Frontend: `src/lib/clean-media.ts`, `src/components/clean-app-content.tsx`, test file.
- Tests: SQL checks in a rollback-only transaction (wash option → 18%, maid option → 5%); vitest for clean_media normalisation.
