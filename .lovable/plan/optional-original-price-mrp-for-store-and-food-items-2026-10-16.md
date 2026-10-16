# Optional "Original price (MRP)" for Store and Food items

## What changes
- **Item editor (Command Center, Store and Food):** a new optional field, "Original price (MRP) ₹", next to Price. If you fill it in, it must be more than the price. Leave it blank for no strike-through.
- **Merchant edits:** these work the same way as price changes. If the item is already live, a merchant's new MRP waits for approval and the live item stays unchanged until then. New items need approval as usual. Command Center edits apply straight away.
- **Approval view:** a new "Original price (MRP)" row shows the current and new values, highlighted when it changed.
- **Customer App:** `app_store_page` (store page, recommended items and menu) and `app_order_again` items return `original_price` only when it is more than the price. Otherwise they return `null`.

## Technical section
- Migration: add `products.original_price numeric NULL`.
- `product_upsert_core`: read `_payload->>'original_price'` (blank → null) and reject with `invalid_original_price` unless it is null or more than the price. Write the column in the same UPDATE as price, so a merchant's edit to a live item still goes only to `pending_changes`, and approval applies it through the existing `staff_review_product_changes` → `product_upsert_core('cc')` path.
- `app_item_card`: `original_price = CASE WHEN p.original_price > p.price THEN p.original_price END`.
- `service-commerce.functions.ts`: add `original_price` to the item list and approval queries and to the save payload.
- `service-commerce-module.tsx`: add the editor input (with check: blank or more than price), and add a "Original price (MRP)" row to the approval table (current vs `pending_changes.original_price`).
- Verify: save an item with an MRP in CC, call `app_store_page` and confirm `original_price` appears only when it is more than the price.
