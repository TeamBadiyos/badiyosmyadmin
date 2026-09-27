# Bulk Courier: time per drop, trips grouped by run, unassigned trips in Live Ops

## 1. Dispatch Plans — "Time per drop (minutes)"
- New field in the create/edit dialog: number 1–15, default 3. Shown as a column in the list.
- Saved through `staff_upsert_dispatch_plan` (today it has no such parameter, so one is added).

## 2. Business > Trips — grouped by dispatch run
- Trips are shown in groups, one group per dispatch run. Group header: time (IST), trigger (manual / qty / slot), method (Google / fallback), drops, trips, total km.
- Each trip row: trip number (1, 2, 3… within the run), label, drops, rider name or "Unassigned". Existing "Open order" stays.
- There is no "run" stored today. A run = trips for the same business with the same trigger created within the same minute. Method comes from the existing distance source on each trip; label = pickup point name.

## 3. Live Ops — Unassigned business trips
- New section in Live Ops listing business trips that are dispatched but have no rider (business, trip no., drops, fare, waiting time).
- "Assign rider": opens the existing courier assign-rider flow for that trip's courier order.
- "Reject": reason required, then confirm "Orders go back to pending and join the next slot. Wallet will be refunded."
- Same roles as today's Live Ops and courier assign (super admin, ops manager).

## Technical details
- Migration:
  - `bulk_dispatch_plans.time_per_drop_min int not null default 3` + validation trigger (1–15).
  - Recreate `staff_upsert_dispatch_plan` with extra `_time_per_drop_min int default 3` (body otherwise unchanged; old signature dropped, grants kept). `staff_list_bulk_plans` already returns full rows; confirm it includes the new column.
  - New `staff_business_reject_trip(_batch_id uuid, _reason text)`, SECURITY DEFINER, super admin / ops manager: only when the linked courier order has no rider; cancels that courier order without its normal customer refund, sets batch status `rejected` + fail_reason, sets its business_orders back to `pending` (batch_id/courier_order_id cleared), credits the delivery wallet with the batch total via `business_wallet_post` (once — skipped if already refunded), writes audit_logs.
- Server: `saveDispatchPlan` passes the new field; `getBusinessDetail` trips also return distance_source, pickup point name and rider name; new `listUnassignedBusinessTrips` and `rejectBusinessTrip` in `bulk-courier.functions.ts`.
- UI: `bulk-courier-page.tsx` (plan dialog, trips grouping), Live Ops page gets the new section reusing the existing assign-rider dialog from courier orders.
