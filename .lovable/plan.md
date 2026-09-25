# Bulk Courier: status values and super-admin-only edits

## 1. Delivery status dropdown
- Offer only `inactive`, `active`, `suspended`.

## 2. Screen permissions
- **Super admin only** (ops manager sees these read-only, with a "Read-only — only a super admin can change this" note):
  - Pricing Plans: create, edit, activate/deactivate
  - Dispatch Plans: create, edit, activate/deactivate
  - Plan assignment on a business
  - Store/Delivery modules and delivery status
  - Wallet "Add credit / Debit"
  - "Add business"
- **Super admin and ops manager:**
  - "Dispatch now"
  - Add/edit pickup points
  - Viewing everything

Two items weren't in your list, so they stay as they are today:
- **Defaults** (vehicle/courier type, low-balance limit): super admin and ops manager can edit.
- **Trips → Open order:** follows the existing courier order detail rules.

## 3. Backend
All seven functions currently run the shared "super admin or ops manager" check. One database change will:
- add a new check that allows active super admins only;
- switch these seven functions to it: `staff_business_wallet_adjust`, `staff_upsert_pricing_plan`, `staff_upsert_dispatch_plan`, `staff_set_plan_active`, `staff_assign_business_plans`, `staff_set_merchant_modules`, `staff_set_delivery_status`.

Nothing else in these functions changes. `staff_business_dispatch_now`, `staff_upsert_pickup_point` and `staff_create_business_account` keep their current check.

## Technical details
- New `public.business_require_super_admin()`:
  - SECURITY DEFINER, `search_path=public`.
  - Raises `Only a super admin can do this` unless `is_active_staff(auth.uid(), array['super_admin'])`.
  - Execute rights go to `authenticated`.
- The migration rewrites each of the seven functions in place:
  - It takes each function's current definition and swaps only `business_require_ops()` for `business_require_super_admin()`.
  - Each function's body, signature and grants otherwise stay the same.
  - Afterwards it checks that none of the seven still calls `business_require_ops`.
- UI:
  - `getBulkAccess` returns `canWrite` (super admin only) plus `canOperate` (super admin or ops manager).
  - Plan tabs, Add business, the plan/modules/status sections and the wallet adjust button use `canWrite`.
  - Dispatch now, pickup points and defaults use `canOperate`.
- Server wrappers for the seven actions also refuse non-super-admins before calling the database.
