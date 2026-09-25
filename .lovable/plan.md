# Plan: Make staff_create_business_account super-admin only

## Goal
Align the backend permission for creating a Bulk Courier business account with the screen, which already shows "Add business" to super admins only.

## Change (one migration, nothing else)
- Update `staff_create_business_account` to call `business_require_super_admin()` instead of `business_require_ops()`, so only an active super admin can create a business account. Ops managers get "Only a super admin can do this".
- No changes to the function's other logic, parameters, or return value.
- No screen changes — the UI already hides "Add business" from ops managers.

## Verification
- Typecheck/build passes.
- Confirm the function body now calls `business_require_super_admin()`.
