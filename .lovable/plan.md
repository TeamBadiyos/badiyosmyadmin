# Bulk Courier > Dispatch Plans: "Cost per extra trip (₹)"

## What changes
- Dispatch Plans get a new field **"Cost per extra trip (₹)"** with helper text "Higher = fewer, longer trips. Lower = more, shorter trips".
- Shown in the create/edit dialog and as a column in the plans list.
- Default for a new plan: the base fare of the business's pricing plan; if none is available, the first active pricing plan's base fare.

## Database (migration)
- Add `cost_per_extra_trip numeric` (nullable, no default) to `bulk_dispatch_plans`.
- Recreate `staff_upsert_dispatch_plan` with one extra parameter `_cost_per_extra_trip numeric DEFAULT NULL`; body otherwise unchanged, grants kept, old signature dropped.

## Code
- `src/lib/bulk-courier.functions.ts`: plan type + list mapping include `cost_per_extra_trip`; `saveDispatchPlan` passes `_cost_per_extra_trip` (null when empty).
- `src/components/bulk-courier-page.tsx`: dialog field (number, ₹, empty allowed) with the helper text; list column showing the value or "—"; new-plan default filled from the pricing plan's base fare.

## Nothing else changes
- No changes to trip creation logic, other plan fields, or permissions.
