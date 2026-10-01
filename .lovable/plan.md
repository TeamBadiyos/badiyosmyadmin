# Coupon form: list visibility + chosen customers

## What you'll see

**Coupon form**
- New switch: "Offers list me dikhayein", with the note "OFF = hidden, works only when the customer types the code".
- Audience choices: All customers / Chosen customers (targeted) / Referral reward.
- Applicable categories: Courier Delivery and Bulk Delivery show "Coming soon" and can't be picked.

**Eligible customers** (only when the audience is Chosen customers, and only after the coupon is saved)
- Add one mobile number, or paste many at once (one per line or separated by commas).
- Numbers that already belong to a customer get the coupon straight away. Numbers that don't have an account yet are saved with a "Signup pending" badge and get the coupon when that person signs up.
- A list showing name, phone and status (Available / Used / Pending), with a Remove button on each row.
- A "WhatsApp message copy karo" button that copies: "Aapke liye badiyos ka special coupon: CODE. App me booking ke time apply karein."
- After a paste, a short summary shows how many numbers were added, how many are pending signup, and how many were invalid or already added.

**Coupon list**
- "Hidden" badge when the coupon isn't in the Offers list.
- "Targeted (X customers)" badge, where X counts customers who already have the coupon plus numbers still waiting for signup.

**Access:** Only Super Admin and Ops Manager can make these changes. Every change is recorded in the activity log.

## Small backend additions (approved, no new tables)
1. The existing coupon-save step also accepts the list-visibility switch, and records the change in the activity log.
2. Staff with offers access can remove pending (not yet signed-up) numbers.
3. One existing-style staff action adds and removes customers for a coupon and records it in the activity log, so log entries come from the backend rather than the app.

## Technical details
- Migration:
  - `CREATE OR REPLACE staff_upsert_coupon` with an added `_show_in_list boolean DEFAULT true`. Drop the old signature first so there is only one version. Audience check allows `targeted`.
  - Add a DELETE policy on `coupon_phone_grants` using `offers_caller_role(auth.uid()) IS NOT NULL`.
  - Add `staff_coupon_grant_phones(_id uuid, _phones text[])`: SECURITY DEFINER, super_admin/ops_manager via `offers_caller_role`. It normalizes numbers to 10 digits, matches `users.phone`, upserts `customer_coupons` (source `staff_grant`, status `available`) or `coupon_phone_grants`, writes `audit_logs`, and returns counts.
  - Add `staff_coupon_revoke_grant(_coupon_id uuid, _kind text, _grant_id uuid)`: deletes only unused `customer_coupons` rows or unconverted phone grants, then writes `audit_logs`.
  - Grant EXECUTE to `authenticated`.
  - Note: this adds functions, which you approved as the small additions.
- `src/lib/offers.functions.ts`:
  - `CouponRow` gets `show_in_list` and `targeted_count`. `listCoupons` adds `customer_coupons` counts and unconverted phone-grant counts.
  - `CouponInput` gets `show_in_list` and the `targeted` audience.
  - Add new `listCouponGrants`, `grantCouponPhones` and `revokeCouponGrant`, all using `requireOffersWriter` for writes.
- `src/components/offers-page.tsx`: add the form switch, the 3 audience options, an EligibleCustomers section, disabled delivery categories (matched by name: Courier Delivery, Bulk Delivery), list badges and the clipboard copy.
