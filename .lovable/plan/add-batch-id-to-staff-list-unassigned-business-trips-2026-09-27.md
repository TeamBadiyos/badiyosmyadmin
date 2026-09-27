# Add batch_id to staff_list_unassigned_business_trips()

## Current state (verified)
- `staff_list_unassigned_business_trips()` (SECURITY DEFINER, ops-gated via `business_require_ops`) returns one jsonb object per unassigned business trip with: courier_order_id, order_code, status, merchant_id, business_name, trip_no, trip_label, drops, total_amount, search_started_at, needs_ops_attention.
- It joins `business_batches b on b.courier_order_id = c.id`; `business_batches.id` (uuid) exists but is not projected. When a trip has no batch row, batch_id will be null (same as trip_no today).

## Changes

### 1. Migration (single statement)
`CREATE OR REPLACE FUNCTION public.staff_list_unassigned_business_trips()` — same body as today, adding one field to the existing `jsonb_build_object`:

- `'batch_id', b.id` (placed after courier_order_id; all existing fields kept, order by and filters untouched).

Same function signature, name, and `business_require_ops()` gate — no permission changes.

### 2. Type surface only (no UI behavior change)
- In `src/lib/bulk-courier.functions.ts`, add `batchId: string | null` to the `UnassignedTrip` type and map `batch_id` in the row mapping, so consumers can use it later.

## Not changed
- `UnassignedTripsPage`, Trips grouping, reject flow, permissions, any other screen.
- No tables or other functions touched.
