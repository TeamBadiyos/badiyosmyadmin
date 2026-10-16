# Delivery GST 5% check + wallet refund check

## What I found

1. Delivery GST rate
- Tax Settings already has "Store & Food order delivery GST" = 5% and "Parcel / courier delivery GST" = 5%.
- Every place that works out delivery GST reads these settings: Store/Food delivery quote, checkout, order bill, Parcel quote, store courier fare. No 18% is fixed in the code for delivery.
- Invoices take the rate saved with each order. One small gap: when an old order has no saved rate, the invoice line shows 0% instead of the Tax Settings rate.
- Tax report and Dashboard money summary use the GST stored on each order, so they follow whatever was charged.
- In the app screens, the only fixed 18% values are commission GST and instant-settlement fee GST, which are correctly 18%.

2. Past orders charged 18% on delivery: none.
- Parcel: all 18 orders were charged 5%.
- Store/Food: only 1 order has a delivery fee, and its delivery GST is not above 5%.
- So the report is empty. I'll add a "Delivery GST check" export anyway so you can re-run it any time.

3. Wallet refunds
- Customer/system refund (normal path): wallet part goes back to the wallet instantly. The refund record holds only the online part. Wallet-only orders get a refund record of ₹0. Correct.
- Staff "Cancel & refund" from Command Center: the online refund is recorded, but the wallet part is NOT returned to the wallet. This is a real gap.
- Dashboard money summary: for wallet-only refunded orders, the refunded share comes out as 0, so badiyos income isn't reversed. Tax report already handles this (fixed last time).

## Changes

1. Staff "Cancel & refund" also returns the wallet part to the customer's wallet, same as the normal refund path, with an audit entry.
2. Dashboard money summary: refunded share = (online refund + wallet used) ÷ (online paid + wallet used), so wallet-only and mixed orders reverse correctly.
3. Invoice delivery line: when an order has no saved rate, use the current Tax Settings "Delivery GST" (never 0 or 18).
4. New read-only "Delivery GST check" list in Finance → Tax report: order no., date, service, delivery fee, GST charged, GST at the Tax Settings rate, difference. Shows only orders where they differ. Export CSV.

## Example again with 5% (Store order: items ₹500, delivery ₹40, coupon −₹50, wallet −₹100)

Delivery GST is added on top of the delivery fee (that's how orders are billed today): ₹40 + 5% = ₹2.00. So the bill is ₹542, the amount due is ₹492, and ₹392 is paid online.

Merchant ledger (unchanged):
```text
Sale +500.00 | Commission 10% -50.00 | Commission GST 18% -9.00 | TCS 0.5% -2.50 | TDS 0
Merchant net / settlement 438.50
```
badiyos P&L:
```text
Commission income           50.00
Delivery income             40.00   (GST 2.00 payable, not income)
Rider share 70%            -28.00
Coupon (marketing)         -50.00
Net                         12.00
Wallet 100: payment method only
```
Customer invoice:
```text
Goods (sold by merchant)          500.00
Delivery charge 40.00 + GST 5% 2.00  42.00
Order total                       542.00
Coupon discount (badiyos)         -50.00
Amount due                        492.00
Paid from wallet                  100.00
Paid online                       392.00
```
(Last time's example assumed GST inside the ₹40. In the real bill it's added on top.)

## Technical details
- `staff_cancel_store_order_apply`: if `wallet_used > 0`, call `wallet_return(user_id,'merchant_order',id,'Shop order refund · to badiyos Wallet')` before the update.
- `staff_dashboard_money` merchant refund ratio: replace `CASE WHEN total_amount>0 ... refund_amount/total_amount` with `(refund_amount+wallet_used)/nullif(total_amount+wallet_used,0)` when refunded; keep cc_reader owner.
- `fin_issue_invoice`: delivery gst_pct fallback `tax_rate('order_delivery_gst')`.
- New `staff_delivery_gst_check(_from,_to)` owned by cc_reader (merchant_orders + courier_orders), plus a table + CSV in the Tax report page.
