# Shop order money check (Store and Food)

## What I found

Since the Customer App change, the order's "total" holds only the money paid by card/UPI (after coupon and wallet). The full bill is still kept separately (item total, delivery, GST, coupon, wallet used).

Already correct (uses the item total, not the paid amount):
- Merchant ledger sale entry = item total
- Commission, commission GST, TCS, TDS and merchant net are worked out when the bill is built, from item prices only
- Settlement takes merchant net from the ledger, so coupons and wallet never reduce it
- Merchant's view of the order shows item total and merchant net

Wrong (needs fixing):
1. Food invoice: the discount is "full bill minus paid". It doesn't show the coupon now, and once the full bill is used, wallet money will be counted as a discount too. There's no wallet payment line.
2. Store invoice (badiyos delivery/platform part): the coupon and wallet aren't shown at all.
3. Dashboard money summary and drill-down: "Discount" is "full bill minus paid", so wallet money shows up as a discount (marketing cost). Wallet should count as a payment.
4. Refund share in the Dashboard money summary and Tax report is worked out from the paid amount only. For orders paid partly by wallet this makes the refunded share too big or too small.

## Changes

1. Invoices (Store and Food):
   - Tax lines stay as they are: food items at 5%, delivery charge at 18% (delivery GST), platform fee at 18%, each worked out on its own value before the coupon.
   - New "Coupon discount (funded by badiyos)" line taken from the order's saved coupon amount. It's shown after tax and doesn't reduce the tax.
   - New payment section: "Paid from wallet ₹X" and "Paid online ₹Y". Invoice total = the full bill; paid lines add up to it after the coupon.
   - Store: the merchant's goods block stays at the item total.
2. Dashboard money and drill-down: discount = the saved coupon amount; wallet shows as its own column, "Paid by wallet".
3. Refund share (Dashboard, Tax report): worked out as refunded money ÷ (paid online + wallet).
4. Already-issued invoices won't be changed. Only new invoices use the new lines. If you want, invoices for orders that used a coupon or wallet can be reissued as credit note + new invoice — that's a separate step.
5. SQL check script (read-only) runs the example below through the real bill and invoice logic and confirms the numbers.

## Example: Store order, items ₹500, delivery ₹40, coupon −₹50, wallet −₹100, paid ₹390

Assumes 10% commission, 18% commission GST, 0.5% TCS, no TDS (merchant under ₹5L), delivery ₹40 including 18% GST, platform fee ₹0, rider share 70%. The script will print the exact figures from the live rates.

Merchant ledger:
```text
Sale (item total)          +500.00
Commission 10%              -50.00
Commission GST 18%           -9.00
TCS 0.5%                     -2.50
TDS                           0.00
Merchant net / settlement   438.50   (coupon and wallet don't affect this)
```

badiyos P&L:
```text
Commission income                50.00
Delivery income (excl. GST)      33.90   (GST payable 6.10)
Rider share 70%                 -23.73
Coupon (marketing expense)      -50.00
Net                              10.17
Wallet ₹100: not income or expense - reduces the customer's wallet balance
Commission GST 9.00 and TCS 2.50: passed to the government, not income
```

Customer invoice:
```text
Goods (sold by merchant)        500.00
Delivery charge  taxable 33.90  GST 18% 6.10   40.00
Bill total                      540.00
Coupon discount (badiyos)       -50.00
Amount due                      490.00
Paid from wallet                100.00
Paid online                     390.00
```
Food works the same way, except the food items are taxed at 5% on the badiyos invoice.

## Technical details
- Update `fin_issue_invoice` (merchant_order branch): add the `coupon_discount` and `wallet_used` columns, total = `total_payable`, add `payments` to the lines JSON. Invoice PDF/view (`agreement-pdf`-style browser renderer in finance pages) gets coupon + payment rows.
- Update `staff_dashboard_money` and `staff_dashboard_drill`: disc = `coupon_discount`, add a wallet field; refund ratio denominator = `total_amount + wallet_used`. Do the same in `staff_tax_report`. Keep the cc_reader owner.
- `ledger_post_order`, `order_bill_core` and settlements stay unchanged.
- Add a SQL test asserting merchant net = 438.50 and invoice due = 490 / online = 390 for the example.
