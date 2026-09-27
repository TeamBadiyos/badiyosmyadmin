# Courier cancellation fee

## 1. Courier > Settings: new card "Cancellation fee (after rider reaches pickup)"
- Fields: Type (Percentage / Fixed ₹), Value, "Rider's share of the fee (%)".
- Helper text: "GST is added on the fee. The rest is refunded."
- Loads the current `courier_cancel_fee_type`, `courier_cancel_fee_value` and `cancel_fee_expert_share_pct` settings.
- Save calls `staff_set_cancel_fee(_type, _value, _rider_share_pct)`.
- Super admin can edit. Everyone else sees the same card read-only.
- The old "Cancellation fee (all cities): ₹0 — set in ops settings." line is removed. It currently sits above the rate table on the Rates screen.

## 2. Bulk Courier > Pricing Plans
- The create/edit dialog gets "Cancel fee after rider arrives": Type (Percentage / Fixed ₹) plus Value. New plans default to Percentage, 50.
- It saves through `staff_upsert_pricing_plan` using `_cancel_fee_type` and `_cancel_fee_value`.
- The plans table gets a column showing the fee, for example "50%" or "₹40".

## 3. Remove the old setting read
- Stop reading the `cancellation_fee` key, which doesn't exist, via `courier_setting`.
- Remove `cancellationFee` from the rates data.

## 4. Courier order detail (cancelled orders)
- A "Cancellation" block shows: Fee, GST on fee, Refund to customer and Rider share.
- The values come from the backend's `courier_cancel_fee_for(_order_id)`, which returns fee_base, fee_gst, fee_total, refund_amount and rider_share.
- The saved `cancellation_fee_base` and `cancellation_fee_gst` on the order are shown when they are set.

Nothing else changes, and no database changes are needed.

## Technical details
- `src/lib/courier.functions.ts`:
  - `getCancelFeeSettings` reads the three settings through `courier_setting`.
  - `saveCancelFee` is super-admin gated and calls the RPC.
  - The order detail also fetches `courier_cancel_fee_for` when the order status is cancelled.
- `src/lib/bulk-courier.functions.ts`:
  - The pricing plan list maps `cancel_fee_type` and `cancel_fee_value`.
  - The save passes both.
- `src/components/courier-page.tsx`:
  - Adds the new card to the settings section and removes the line from the Rates screen.
  - Adds the cancellation block to the order detail.
- `src/components/bulk-courier-page.tsx`: adds the new dialog fields and the table column.
