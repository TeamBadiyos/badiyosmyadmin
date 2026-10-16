# Store / Food categories (EN + मराठी, per city with default)

## Status of the wallet task (already done)
- Moved 27 customers' old coins into the new wallet as 30-day bonus: ₹3,050 in total, and each customer's balance matches. The old total showed ₹2,972 because one customer had -₹78 of history. That customer was closed at ₹0 instead of going negative.
- Before → after for 5 customers (old coins → new wallet bonus): Janhavi Baheti 838 → 838 · Smita Bajaj 410 → 410 · Anjushri Chandak 400 → 400 · Gaurav Baheti 292 → 292 · P S 220 → 220. Difference: ₹0.
- Still to do, first step of this plan: make the new internal wallet helpers impossible to call from the apps. This clears the security warnings the wallet change added.

## What exists today
- **Store types:** 11 rows, English only, no city. In use: Packing Material (3 stores), Kirana & Grocery (2), Medical & Pharmacy (2), Stationery & Books (1), Food (1, Amantran Little Bite).
- **Product categories:** there is no shared list for Store items yet. Each item only has the store's own free-text section name (Namkeen, Kitchen use, Disposable Plates…). No item is linked to a shared category.
- **Food categories:** 9 rows, all switched off, no items linked.

## Mapping (shown for your approval, nothing deleted)
Old rows are **renamed in place** where they match, so stores keep their link. Rows with no stores or items are retired.

Store types:
```text
Kirana & Grocery (2)     -> Grocery / किराणा
Fruits & Vegetables      -> Fruits & Vegetables
Dairy & Milk             -> Dairy & Bakery
Bakery & Sweets (0)      -> Sweets & Namkeen
Medical & Pharmacy (2)   -> Medical
Stationery & Books (1)   -> Stationery & Books
Electronics & Mobile     -> Mobile & Electronics
Hardware & Electrical    -> Hardware & Electricals
Packing Material (3)     -> Packaging Material
Food (1: Amantran)       -> Sweets & Namkeen
Clothing & Footwear (0)  -> retired (no stores)
```
The other new types are added fresh, with "Other / इतर" last.

Food categories: Thali, South Indian, Chinese, Snacks, Sweets and Ice Cream keep their names. Sandwich becomes Sandwich & Rolls. Pizza & Burger becomes Pizza, and Burger is added. Beverages becomes Shakes & Juices. The rest are added.

Product categories: the 22-item list is created. Amantran's items (Namkeen, Upvas, Side dish), the old "Food" store, go to **Snacks & Namkeen**. Other items get a suggested category from their section name, e.g. Disposable… → Packaging, Kitchen use → Home & Kitchen, Books → Stationery, Home temple → Puja Items, Grocery → Atta, Rice & Dal. You get a review screen to accept or change each one before anything is saved.

## What you'll be able to do (same for all three lists)
- See each list in order with icon, English and मराठी name, on/off, and the number of stores or items using it.
- "+ Add category": English name, मराठी name, square photo (200×200, compressed), on/off.
- Edit, reorder with ▲▼, and delete. Delete is blocked while stores or items use it; a "Move to…" option lets you move them first. "Other / इतर" always stays last and can't be deleted or moved.
- Clean placeholder icon until a photo is uploaded.
- Per city: a city can have its own list. If it has none, it uses the Default list.
- Customer App: only categories with at least one live store or item are returned, in order, with both languages.

## Technical details
- Security fix: revoke EXECUTE on wallet_spend / wallet_return / trigger functions from public/anon/authenticated.
- `store_categories` and `catalog_categories` get `name_mr` and `city_id` (null means default). The Default list is the seed. No auto-fill-city trigger, since null must stay default. Add the `cc_reader_all` SELECT policy.
- `catalog_categories.service_type` gains 'store' for product categories. `products.category_id` (FK to catalog_categories) is filled from the approved mapping. The free-text section name is kept.
- Staff RPCs: list/upsert/reorder/move-and-delete, all audited. Guards: "Other" is locked last, and delete fails while anything is in use.
- Public RPC `app_categories(_kind, _city_id)` returns only categories with live stores/items, using the city list with a default fallback.
- UI: one shared category manager component used in Store → Categories (two tabs) and Food → Categories. WebP upload at 200×200.
- The Customer App is a separate project and must read `app_categories`.
