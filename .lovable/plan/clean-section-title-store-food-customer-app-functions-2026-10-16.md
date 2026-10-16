# Clean section title + Store/Food Customer App functions

## 1. Clean Home: "Section title" for the cards section
- App content → Hero & cards: new field "Section title" (EN + मराठी), shown in the live preview above the cards.
- Default: "What our experts do" / "आमचे एक्सपर्ट काय करतात" (saved for Latur and Default if empty).
- `app_service_content('clean')` returns `cards_section_title: { en, mr }`. Wash output unchanged.

## 2. Public functions for the Customer App (Store / Food)
All are public read functions (signed-in customer for Order again). Only live, approved, non-hidden stores and items. `_service_key` = 'store' or 'food'.

### a. `app_commerce_home(_service_key, _city_id, _lat, _lng, _category_id default null)`
```text
{
  categories:  [{ id, name_en, name_mr, icon_url, sort }],   // >=1 live store/item, CC order, "Other" last
  recommended: [Store],   // up to 6, from CC Sponsored slots for city (+ category if given), active within start/end dates, by position
  stores:      [Store]    // all other live stores in city, open first then nearest first
}
Store = { id, slug, name, photo_url, store_type: { id, name_en, name_mr },
          distance_km, rating (null if < 3 ratings), rating_count, is_open, next_open_at }
```
- Store category filter: store's store type (Store tab) / item category (Food tab).
- is_open uses store hours, schedule overrides and the store's on/off status.

### b. `app_store_page(_store_id)`
```text
{
  store: { id, name, photo_url, store_type, address, rating, rating_count,
           is_open, opens_at (today / next opening time), closes_at },
  recommended: [Item],                 // max 6, merchant's picks in their order
  menu: [{ category: { id, name_en, name_mr }, items: [Item] }]
}
Item = { id, name, photo_url, size, price, original_price, in_stock,
         variants: [{ id, name, price, is_default }],        // e.g. Half / Full
         addon_groups: [{ name, min, max, options: [{ id, name, price }] }] }
```

### c. `app_order_again(_service_key)`
```text
{ stores: [Store-lite with last_ordered_at], items: [{ ...Item, store_id, store_name, last_ordered_at }] }
```
Last 3 distinct stores and last 3 distinct items from the customer's delivered orders; only still-live ones.

## Points to note
- Items have no "original price" field today; `original_price` will be null unless a separate MRP field is added — tell me if you want one added to the item editor.
- Sponsored slots have no limit enforcement today; the function simply takes the first 6 by position.

## Technical section
- One migration: three `SECURITY DEFINER` `app_*` functions (stable, `search_path=public`), granted to anon + authenticated (order_again: authenticated only, uses `auth.uid()`).
- Sources: merchants, store_categories / catalog_categories, sponsored_slots (service_type, city_id, store_category_id, starts_at/ends_at, is_active), store_ratings, merchant_store_hours + merchant_schedule_overrides, products (is_active, is_available, admin_hidden, approval_status, is_recommended/recommended_order, unit as size), product_variants, product_addons (group_name, min_select, max_select), merchant_orders/merchant_order_items.
- Distance via haversine from merchant lat/lng; image paths via the same catalog image URL rule used in CC.
- Clean title stored in homepage_sections clean_content; editor in the Clean App content tab.
- Verify by calling each function for Latur and pasting sample output.
