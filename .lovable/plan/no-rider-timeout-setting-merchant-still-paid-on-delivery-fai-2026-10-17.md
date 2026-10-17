# No-rider timeout setting + merchant still paid on delivery failure

## 1. "No rider found" auto-cancel time, per city
- Store → Settings → Booking rules and Food → Settings → Booking rules get a new box: "Auto-cancel if no rider found (min)". It is saved per city, the default is 30, and the allowed range is 5–240.
- The rider search job reads the order's city and service. Store and Food can have different values. Today it uses one fixed 15 minutes for everyone; that is replaced by this setting.
- The customer policy line stays as written; it doesn't mention the minutes.

## 2. Merchant still paid when the failure is after the store accepted
**When it applies:** a Store/Food order is auto-cancelled because no rider was found or delivery failed, and the store had already accepted it.

**What happens:**
- **Merchant:** earns the order as if it was delivered. The sale, commission, commission GST, TCS and TDS go to their ledger and settlement in the normal way. The customer's refund does **not** take this money back.
- **Customer:** gets a full refund, exactly as today.
- **badiyos:** the refund is recorded as a cost, shown in P&L as a new line "Delivery failure refunds". Commission income still counts.
- **Before the store accepted:** nothing changes. The merchant earns nothing.

**Staff switch per order:** the order detail in Command Center shows "Pay merchant: On" for these orders. Super admin or ops manager can turn it off, with a required reason, while the order hasn't been settled yet. Turning it off removes the merchant's earning (a reversal entry), and the P&L cost becomes a normal refund. The change is recorded in the audit log, and the order card shows a tag either way.

## What I'll check before changing anything (read-only)
- Today the merchant is credited only when an order is delivered, and a completed refund reverses that credit. I've confirmed this.
- I'll also read the merchant ledger posting, how settlements pick orders (they currently skip refunded orders), the commission snapshot and the P&L / dashboard money summary, so these orders are included in each and counted only once.

## Technical details
- city_ops_settings keys `store_no_rider_cancel_minutes` / `food_no_rider_cancel_minutes` (added to city_ops_keys, default 30, default-city fallback); courier_sweeper looks up the merchant's service_type + city.
- merchant_orders new columns: `merchant_pay_on_failure boolean`, `merchant_pay_off_reason text`, `failure_cause text` ('NO_RIDER_FOUND'/'DELIVERY_FAILED').
- store_sync_from_courier: if accepted_at is set, stamp failure_cause + merchant_pay_on_failure = true and post the merchant earning (same code path as delivered).
- Refund reversal / settlement-adjustment triggers skip orders with merchant_pay_on_failure = true; settlement picks them even though they are refunded.
- New RPC `staff_set_merchant_pay_on_failure(_order_id, _on, _reason)`: audited, refused once the order is in a settlement.
- P&L / dashboard money summary: refunds of these orders go to "Delivery failure refunds".
- Rider / Courier Expert payouts unchanged. No live order placed; checks are read-only.
