# Order cards + estimated time

## Confirmed current state

- The active **Clean → Service Catalogue** screen reads and saves price options through `service_price_options` (`ServiceCataloguePage` → `catalogue.functions.ts`).
- The legacy `service_catalogue_config` helper still exists, but no screen imports or calls it. This change will not use it.
- `service_price_options.estimated_minutes` already exists. Current flat-price options have estimates; the Catalogue UI does not yet display or edit them.
- Clean and Car Wash share the Live Orders booking card. It currently shows `bookings.price`, not the actual paid total.
- Courier appears both on the Live Orders board and Courier → Orders. Store has its own Commerce board. Their current cards show only one total.
- No database table or database function is needed.

## Build

### 1. One consistent payment summary on every operational order card

Create one shared compact payment display and use it on:

- Clean and Car Wash cards on Live Orders
- Courier cards on Live Orders
- Courier → Orders cards
- Store → Orders cards

Display rules:

- Primary line: **Paid ₹X**
- Secondary line: **Base ₹X · Coupon −₹X · GST ₹X · Delivery ₹X**
- Omit every zero or non-applicable part.
- For unpaid/awaiting-payment records, **Paid ₹0** rather than presenting the amount due as paid.
- Use each order’s saved financial snapshot only:
  - Clean/Car Wash: `price`, `discount_amount`, `gst_amount`, `total_amount`, and payment ID/status.
  - Courier: `base_amount`, `extra_fee`/fare snapshot, `discount_amount`, `gst_amount`, `total_amount`, and payment status.
  - Store: `items_total`, `delivery_fee`, and `total_amount`; commission GST remains in the merchant settlement detail and will not be mislabeled as customer GST.

Extend only the existing board/list response shapes so all cards receive these fields; no recalculation or data write will occur.

### 2. Correct flat-price versus time-based labels

- Resolve booking pricing type from its linked `price_option_id` and service.
- Flat-price cards show **“Car Wash · Flat”** (service option label + Flat) and never show scheduling minutes as customer-facing duration.
- Duration-based cards keep their option label such as **“1 Hour”** or **“2 Hours”**.
- Preserve a safe legacy fallback for older bookings without a linked price option, without modifying those rows.

### 3. Estimated time in Service Catalogue

- Include `estimated_minutes` in the active Catalogue read model.
- For flat-price options, place **Estimated time (min)** beside **Customer price** in the item editor.
- Show the exact note: **“Used for scheduling and Expert busy time. Not shown to customers.”**
- Require a positive whole-minute value for active flat-price options.
- Keep the field read-only for ops managers; only super admins can change it.
- Save it to `service_price_options.estimated_minutes` and add a before/after audit entry for each change.
- Keep the existing price, media, task type, and activation behavior unchanged.

## Safety and verification

- Create no tables, columns, database functions, or seed data.
- Delete no rows and do not use the legacy `service_catalogue_config` write path.
- Verify examples including the current Car Wash snapshot: **Paid ₹93** with **Base ₹249 · Coupon −₹160 · GST ₹4**, and confirm its label is **Car Wash · Flat**.
- Check Clean duration, zero-value omission, unpaid cards, Courier, and Store cards at desktop and mobile widths.
- Run focused type/build checks and inspect the preview for card alignment and overflow.
