# Courier Command Center

A new "Courier" section in the sidebar with five tabs, built on the existing courier tables and staff RPCs. No new tables.

## Access

- Super Admin: full write on all five tabs.
- Ops Manager: read-only — every create/edit/toggle/action button hidden or disabled.
- All other roles (area partner etc.): the Courier section does not appear at all.
- Every change goes through a staff RPC that writes a before/after entry to the activity log.

## Tabs

### 1. Service Toggle
City-wise list of all services (courier plus the existing ones) with an on/off switch. Turning a service off first shows a confirm dialog with the count of orders currently running for that service in that city.

### 2. Vehicle Types
List with add/edit: name, icon, max weight, inclusions, exclusions, required skill, required documents, sort order, plus an active toggle.

### 3. Rates
Rates per city + vehicle: base fare, included km, per km, min fare, platform fee, commission %, cancellation fee. Rows that are still placeholders carry a "Placeholder" badge; a "Mark as confirmed" button clears it and is visible only to Super Admin.

### 4. Courier Types + Mapping
Add/edit courier (parcel) types with icon, extra fee, instructions and active toggle, plus a mapping grid showing which parcel type is allowed on which vehicle, toggled per cell.

### 5. Live Orders
Courier order list with a status filter and search. Clicking an order opens a detail panel with the full event history and actions: reassign rider, force cancel, refund, and resolve a FAILED_DELIVERY incident with full / partial / no refund.

## Technical notes

Existing RPCs reused as-is: `staff_courier_set_service_flag`, `staff_courier_reassign_rider`, `staff_courier_force_cancel`, `staff_courier_refund`, `staff_courier_resolve_incident`. Role gates `courier_is_super_admin()` / `courier_is_ops_staff()` already exist.

Gap found: there are no config-CRUD RPCs yet for vehicle types, rates, courier types and the vehicle↔courier-type mapping — only super-admin RLS on the tables. Since the requirement is "no direct table writes, everything audited", one migration adds four security-definer RPCs (no new tables, no schema changes):

- `staff_courier_upsert_vehicle_type(...)` / `staff_courier_set_vehicle_type_active(_id, _active)`
- `staff_courier_upsert_rate(...)` / `staff_courier_confirm_rate(_id)` (clears `is_placeholder`)
- `staff_courier_upsert_courier_type(...)` / `staff_courier_set_courier_type_active(_id, _active)`
- `staff_courier_set_vehicle_courier_type(_vehicle_type_id, _courier_type_id, _active)`

Each gates on `courier_is_super_admin()` and inserts into `audit_logs` (actor_id, action, target_table, target_id, before_state, after_state), matching the existing pattern.

Note: `courier_vehicle_rates` has no cancellation-fee column today; the cancellation fee is read from the existing `courier_setting(...)` ops config and edited there rather than per rate row — unless you prefer adding a per-rate column.

New files:
- `src/lib/courier.functions.ts` — authenticated server functions: role/access resolution, list queries for service flags (+ active order counts), vehicle types, rates, courier types, mapping, orders and order events; mutation wrappers calling the staff RPCs.
- `src/components/courier-page.tsx` — the five-tab screen with modals, using existing Command Center styling (Badiyos green, Nunito Sans, 8pt grid).

Changed files:
- `src/routes/_authenticated/dashboard.tsx` — "Courier" nav entry/group, role visibility, route rendering.
