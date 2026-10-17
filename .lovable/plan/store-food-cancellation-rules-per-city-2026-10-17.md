# Store / Food cancellation rules (per city)

## What exists today
- Customer cancel (`store_cancel_order`) already blocks cancelling once the store has accepted, and marks a refund.
- Accept timeout (store sweeper) already auto-rejects and marks a refund.
- Staff "Cancel & refund" exists, returns the wallet part, but the refund amount is not limited to full / partial / none choices, and a reason is optional.
- There is no Store/Food cancellation policy text, and the existing policy function only covers Clean Home / Clean Auto.
- How "store rejects", "no rider found" and "delivery failed" refund today has not been confirmed yet. The shared refund helper is not in the saved history, so step 1 reads it from the live database.

## Changes

1. **Check first (read-only):** read the live refund helper and the store-reject, no-rider and delivery-failed paths. Confirm for each one whether it refunds in full and returns the wallet part. Report anything that doesn't.

2. **One shared full-refund helper for shop orders.** The wallet part goes back to the wallet instantly. The online part is left as a normal Razorpay refund, pending for the refund job. If the customer chooses "wallet for all", the whole amount goes to the wallet and no Razorpay refund is made. Items are restocked. Merchant earnings are not touched.

3. **Customer cancel (before accept only):** full refund, with the customer's choice of refund destination. After the store accepts, cancelling is refused with "contact Help".

4. **Automatic full refunds:** store rejects, accept timeout, no rider found, and delivery failed all use the same helper.

5. **Staff cancel in Command Center:** the order's Cancel action asks for Full / Partial (₹ amount, up to what was paid) / No refund, plus a required reason. A partial refund returns the wallet part first, then the online part. Every cancel is audited. Super admin and ops manager only.

6. **Policy text:** add a "Cancellation policy" box (EN + मराठी lines) to Store Settings → Customer messages and Food Settings → Customer messages. It is saved per city, with the Default city as fallback, and pre-filled with your four lines.

## Functions for the Customer App
- `app_store_cancel_quote(_order_id)` → `{ can_cancel, reason_code, refund_total, wallet_part, online_part, destinations: ['wallet','original'] }`
- `app_store_cancel_order(_order_id, _destination 'wallet'|'original', _reason)` → `{ ok, refund_total, to_wallet, to_original }`, or `{ ok:false, code:'too_late' }`
- `app_cancellation_policy('store'|'food', _city_id)`: the existing function, extended so it returns the Store/Food `lines_en` / `lines_mr`

## Technical details
- Policy stored in city_ops_settings keys `store_cancel_policy` / `food_cancel_policy` (JSON {en:[],mr:[]}); default-city fallback.
- New `store_refund_full(_order_id, _destination, _cause)` built on `wallet_post` (cash/bonus returned to the same parts) plus refund_status='pending' for the online part; `store_cancel_order` becomes a wrapper so the old app keeps working.
- `staff_cancel_store_order` gains `_mode full|partial|none` and `_amount`; reason required.
- Read-only checks only; no live order placed. Courier Expert / rider payouts unchanged.
