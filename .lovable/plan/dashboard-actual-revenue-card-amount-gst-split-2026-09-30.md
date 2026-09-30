# Dashboard: Actual Revenue card — Amount & GST split

The "Actual Revenue" card's small text currently says "Net collected after discounts & refunds". Replace it with the actual split: how much is the service amount and how much is GST.

## What changes

### 1. `src/lib/dashboard.functions.ts`
- Add `gst_amount` to the bookings revenue select (line 114) — column confirmed present.
- `courier_orders` select already needs `gst_amount` added (column confirmed present).
- In both revenue loops, for rows that count toward revenue (not cancelled, not test payments, not coin/`free_` payments), accumulate `gstCollectedToday += Number(r.gst_amount ?? 0)`.
- If a row is refunded, subtract its GST from the GST total the same way revenue is reduced (proportional to the refunded share), so the split always adds up to the card's big number.
- Return a new field `gstCollectedToday` alongside `todayRevenue`.
- Store orders (`merchant_orders`) have no customer GST column, so they contribute amount only — no change there.

### 2. `src/routes/_authenticated/dashboard.tsx`
- Actual Revenue card hint becomes: `Amount ₹X · GST ₹Y` where X = todayRevenue − gstCollectedToday, Y = gstCollectedToday.
- No layout, card count, or other card changes.

## Verified before planning
- `bookings.gst_amount` and `courier_orders.gst_amount` exist; `merchant_orders` has no customer GST column.
- Current hint text lives at `src/routes/_authenticated/dashboard.tsx:732`.

## Notes
- No database changes, no new tables or functions.
- Example with today's data: Actual Revenue ₹93 → hint shows "Amount ₹89 · GST ₹4".
