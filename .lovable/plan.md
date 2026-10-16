# CC one pass: layout leftovers, customer note, full wallet pay, cancellation rules

## A. Layout (Clean Home + Clean Auto)
Items 1–7 are already done. One item is left:
- **Customer messages:** add a "Cancellation policy" text box in English and मराठी, saved per city per service. It starts with the 5 default lines from your file.

## B. Customer note
- Bookings get a "Customer note" field, up to 300 characters. Longer notes are cut, not rejected.
- The note can be sent when a booking is created.
- **CC booking detail:** shows a "Customer note" block when a note exists.
- **Expert App:** a new job-details function returns the note.

## C. Full wallet payment
New server-side booking function. When the badiyos Wallet covers the whole total:
1. Re-price the booking on the server (same price and GST rules as today).
2. Debit the wallet: cash first, bonus last.
3. Create the booking as paid and confirmed. Expert search starts as normal.
4. Issue the invoice right away. Razorpay is not used.

If anything fails, nothing is saved. Partial wallet payments stay exactly as they are today.

## D. Cancellation rules (per city, Clean Home and Clean Auto)
**1. Fee rules.** Settings → Booking rules gets three new settings:
- "Fee after expert assigned": a percentage, default 50%, of the amount paid including GST. The rest is refunded.
- "No refund after expert arrived": on by default.
- Before an expert is assigned, and for auto-cancel: full refund.

These replace today's flat ₹100 fee.

**2. How money goes back:**
- Card/UPI part: normal Razorpay refund. No instant refund.
- Wallet part: back to the wallet immediately.

**3. Refund destination.** Each refund records one of two choices:
- "badiyos Wallet": credited instantly.
- "Original payment method": 5–7 working days.

Who chooses:
- **Customer cancels:** the customer picks.
- **Auto-cancel:** always the original method.
- **Staff cancels:** the original method by default. Staff can pick Wallet in CC.

Where it shows: on the booking detail, the Refunds page and the credit note.

**4. Policy text:** the Customer App receives the policy text plus the fee %, the arrived rule and the auto-cancel minutes. Line 4 fills in the city's real auto-cancel minutes, so it doesn't say 120 when a city uses a different number.

## Outside this project
The Customer App and Expert App are separate projects. They need their own changes to use these:
- send the note
- call the new pay and cancel functions
- show the policy and the refund choice

## New functions (names)
- `app_create_booking_wallet(_payload jsonb)`: full-wallet booking (C)
- `app_cancel_quote(_booking_id uuid)`: shows the fee, the refund and the choices before cancelling (D)
- `app_cancel_booking(_booking_id uuid, _destination text)`: customer cancel, `'wallet' | 'original'` (D)
- `staff_cancel_booking_v2(_booking_id, _reason, _destination)`: staff cancel with a refund choice (D)
- `app_cancellation_policy(_service_key text, _city_id uuid)`: policy text plus rules (D)
- `expert_job_details(_booking_id uuid)`: includes customer_note (B)

## Technical details
- **Migration:**
  - `bookings.customer_note text` with a 300-character check.
  - `bookings.refund_destination text` (`wallet` / `original`) and `bookings.wallet_paid_amount numeric`.
  - The same `refund_destination` column on `customer_credit_notes`.
  - New city_ops_settings keys: `{clean,wash}_cancel_fee_percent` (50), `{clean,wash}_no_refund_after_arrived` (1), `{clean,wash}_cancel_policy` (jsonb, EN/MR).
  - All new keys are added to `city_ops_keys()`.
- **Refund engine:**
  - One SQL helper, `booking_refund_split(_booking_id)`, returns the fee, the wallet part and the Razorpay part. It is used by quote, customer, staff and auto-cancel.
  - The wallet part goes through `wallet_post(... 'refund' ...)`.
  - The Razorpay part is marked `refund_pending` and sent by the existing refund job, so no Razorpay keys are needed in the database.
  - When the customer chooses Wallet, the whole refund goes to the wallet and nothing goes to Razorpay.
- **Existing code:** `customer-cancel-booking` and `system_auto_cancel_booking_no_expert` are changed to use the helper. The ₹100 constant is removed. Auto-cancel stays a full refund to the original method.
- **Credit note:** `fin_issue_credit_note` gets an optional destination argument.
- **UI:**
  - Settings → Booking rules: fee %, arrived switch.
  - Customer messages: policy editor.
  - Booking detail: customer note, refund destination, and a Wallet/Original choice in the staff cancel dialog.
  - Refunds page: a destination column.
- **Tests (vitest):**
  - 50% fee on ₹303 gives a ₹151.50 fee and a ₹151.50 refund.
  - After arrived with the switch on gives a ₹0 refund.
  - Before assignment gives a full refund.
  - A wallet + Razorpay split returns the right parts.
  - The note is cut to 300 characters.
