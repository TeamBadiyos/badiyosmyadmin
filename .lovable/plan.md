# Switch unassigned trips and trip grouping to the backend's data

## 1. What I created last time
- `staff_business_reject_trip(_batch_id, _reason)`. This was the only database function I created for these two features.
- I did not create a database function for the unassigned-trips list. My list was built in the screen's own server code (`listUnassignedBusinessTrips`), which read the tables directly.

## 2. Backend functions — what happens to each
- **Reject:** the backend has since replaced `staff_business_reject_trip` with its own version, using the same name. It now calls `business_reject_trip_internal`, and the refund happens only once, in `business_sync_from_order`. My version no longer exists, so there is nothing to drop. The function is **kept**, because it is now the backend's function.
- **Unassigned list:** switch the Live Ops screen to the backend's `staff_list_unassigned_business_trips()`. Remove my server-side table queries and my "same minute" trip-number logic.
- Since the backend list returns the courier order but not the trip ID, Reject looks up the trip by its courier order before calling the backend function.
- No database changes.

## 3. Business > Trips
- Group the trips by the `business_dispatch_runs` table, matched through `business_batches.dispatch_run_id`. Each group header shows the run's time, trigger, method, drops, trips and total km, as stored by the backend.
- Each trip row shows `business_batches.trip_no` and `trip_label`, plus drops and the rider name or "Unassigned".
- Remove the "same minute" grouping and the pickup-name label.
- Older trips that have no run go into one group labelled "Earlier trips (no run)".

## Technical details
- `src/lib/bulk-courier.functions.ts`:
  - `getBusinessDetail` selects `trip_no, trip_label, dispatch_run_id` on batches (it drops `pickup_name`) and also returns `runs` from `business_dispatch_runs` for that merchant.
  - `listUnassignedBusinessTrips` becomes a call to the RPC `staff_list_unassigned_business_trips`, with its fields mapped.
  - `rejectBusinessTrip` takes `courier_order_id`, finds the batch id, then calls `staff_business_reject_trip`.
  - `groupRuns` is deleted.
- `src/components/bulk-courier-page.tsx` `TripsTab`: build groups from `runs` and order trips by `trip_no`.
- `src/components/unassigned-trips-page.tsx`: use the new fields (trip_no, trip_label, order_code, and search_started_at for the waiting time). The toast no longer claims how much was refunded, since the backend refunds on its own.
