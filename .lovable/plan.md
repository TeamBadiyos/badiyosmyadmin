# Bulk Courier: business not showing, duplicate creates, phone lookup

## What I found
- **Business was created, but the list can't read it.** Your number 9999900000 is linked to the existing "Badiyos Demo Store", and its business profile exists. The signed-in staff account has no permission to read the business tables at all (`business_profiles`, `business_orders`, `business_batches`, `bulk_*_plans`, pickup points, receivers, top-ups). The list reads nothing and shows "No businesses yet". The same gap affects the business detail tabs and the plan lists.
- **"Created 2 times":** the history shows two create actions for that number. The second one didn't make a new store. It overwrote the same one, but the screen still said "Business created" with no warning.
- **No lookup by phone:** when you type a number that already belongs to a store, the form doesn't show that store's details.

## Fixes
1. **Database:** give signed-in staff read access to those business tables. The existing rules already limit rows to super admin, ops manager, or the owning merchant, so no rule changes are needed. Nothing else changes.
2. **Add business form:**
   - After 10 digits are typed, look up the number.
   - If a store exists, show "Existing store found: <name>, <city>, status" and pre-fill the business name and city.
   - If it's already a business, show "Already a Bulk Courier business" and swap the Save button for "Open business".
   - The Save button is disabled while saving, so a double tap can't submit twice.
3. **Messages:** say "Linked to existing store <name>" when the number belonged to a store, and "Business created" only for a new one.
4. **List errors:** if the list fails to load, show the error instead of "No businesses yet".

## Technical details
- Migration: `GRANT SELECT` to `authenticated` on business_profiles, business_orders, business_batches, business_pickup_points, business_receivers, business_wallet_topups, bulk_pricing_plans, bulk_dispatch_plans (the first build step confirms which grants are missing).
- New server fn `lookupBusinessPhone` (requireOps): finds merchants by the last 10 digits of the phone and returns id, store_name, city, status, and whether a business profile exists.
- `createBusiness` returns `linkedExisting` so the screen can show the right message.
- Then check signed in as super admin that the Demo Store appears in the list.
