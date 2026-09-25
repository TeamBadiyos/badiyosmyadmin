# Courier > Bulk Courier

Add a new item "Bulk Courier" to the Courier sidebar group, with three tabs. The only other change is a new Business filter in Courier > Orders. Permissions work like the other courier screens: super admin and ops manager can edit, and other roles only see.

## 1. Pricing Plans
- A table with these columns: name, base fare, included km, per km, min fare, extra drop fee, return ₹/km, commission %, used by N, active.
- A create/edit dialog. When editing, it shows "Used by N businesses. Changes apply to new trips only."
- Deactivate/activate uses a confirm step. If the system refuses, the in-use message is shown. There is no delete.

## 2. Dispatch Plans
- A table and a create/edit dialog with these ticks: Manual dispatch, Min qty [n], Time slots (add/remove HH:MM chips, IST), Max drops per trip.
- At least one tick is required. The used-by and deactivate rules match Pricing Plans.

## 3. Businesses
- The list shows name, phone, city, delivery status, pricing plan, dispatch plan, wallet balance, pending orders and trips today.
  - The balance shows in red if it is negative or below the low-balance limit.
  - A "No plans" warning chip appears when no plans are assigned.
- "Add business" asks for phone, business name and city.
- The business detail has five tabs:
  - **Setup:** store/delivery modules; delivery status (reason required); pricing and dispatch plan dropdowns (active plans only); default vehicle/courier type; low-balance limit; pickup points (add/edit).
  - **Receivers:** a read-only list with search.
  - **Orders:** status filters, reference no., receiver and a trip link. "Dispatch now" requires a reason.
  - **Trips:** status (planning, awaiting balance, dispatched, failed), fare, distance and drops. The linked courier order opens the existing courier order detail.
  - **Wallet:** balance, ledger (delivery wallet only), top-ups, and "Add credit / Debit" (reason required, with a confirm dialog).

## 4. Courier > Orders
- Add a "Business" filter.
- Show the business name on trips created for businesses.

## Technical details
- No database changes are needed. The existing RPCs are:
  - Plans: `staff_list_bulk_plans`, `staff_upsert_pricing_plan`, `staff_upsert_dispatch_plan`, `staff_set_plan_active(_kind,_id,_active,_reason)`
  - Businesses: `staff_create_business_account`, `staff_assign_business_plans`, `staff_upsert_business_profile` (vehicle/courier type, low-balance limit)
  - Setup and pickup points: `staff_set_merchant_modules`, `staff_set_delivery_status`, `staff_upsert_pickup_point`
  - Orders and wallet: `staff_business_dispatch_now`, `staff_business_wallet_adjust`
- The screens read directly from `bulk_*_plans`, `business_profiles`, `merchants` (delivery_status, delivery_wallet_balance, store/delivery_enabled), `business_orders`, `business_batches`, `business_receivers`, `business_pickup_points`, `business_wallet_topups` and `wallet_ledger` (wallet_type='delivery', owner_type merchant).
  - These reads rely on the existing staff access rules. The first build step is to check them.
  - If a read is blocked, no workaround is added. The build stops and reports which read is missing.
- "Used by N" is counted from `business_profiles.pricing_plan_id` / `dispatch_plan_id`.
- The Business filter and name in Courier > Orders come from `courier_orders.business_merchant_id`.
- New files: `src/lib/bulk-courier.functions.ts` (auth-gated server functions) and `src/components/bulk-courier-page.tsx`.
- `CourierPage` gets a new `bulk` section, and the nav key `courier-bulk` is added to the Courier group with the same role list as other courier items.
