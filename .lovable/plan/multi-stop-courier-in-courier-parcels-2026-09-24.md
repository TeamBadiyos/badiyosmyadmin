# Multi-stop Courier in Courier & Parcels

Every screen and action that exists today keeps working. Old orders (1 pickup, 1 drop, 1 parcel) look the same as before, with the new sections added.

## A. Rates
- "Regular" / "Corporate" tabs above the rate cards. "New rate" uses the tab that is selected.
- Rate dialog: all current fields stay. New: Segment (locked when editing), plus a "Multi-stop charges" section with Extra pickup fee, Extra drop fee, Max pickups, Max drops, Return charge per km, and the helper text you gave.
- Regular: both max fields are required and must be at least 1. Corporate: each max field gets a "No limit" checkbox, which saves an empty value.
- Rate card second line: "Extra pickup ₹X · Extra drop ₹Y · Max P/D (or No limit) · Return ₹Z/km".

## B. Courier settings card
The courier settings are stored in the ops settings table. A new card (super admin / ops manager) lets you edit:
- Wait before rider can mark a stop failed (minutes). Default 10.
- Escalate unpaid return charge after (minutes). Default 15.
Values must be whole numbers from 1 to 120. If nothing is saved yet, the card shows the default. Every change goes into the audit log.

## C. Order list
- A "2P · 3D" badge when an order has more than one pickup or drop.
- A "Return payment pending" chip when an order has a pending return charge.
- New "Multi-stop" filter. The current filters stay.

## D. Order detail
- **Route:** every stop in order, with type, address, contact, status chip, times and fail reason. The stop the rider is at now is highlighted.
- **Parcels:** "Pickup N -> Drop M", description and status chip.
- **Charges** (only shown if there are any): km, amount, GST, total, status, paid time and Razorpay id. Pending charges get a "Waive" button, which needs a reason and a confirm step.
- **Fare breakdown:** a stops-fee line when it is more than 0.

## E. Verify manually
On the stop the rider is at now, a "Verify manually" button opens a reason box and a confirm dialog ("Only use this after confirming by phone with the contact."). The reason must be at least 10 characters. For a return stop, it is blocked while a return charge is still pending.

## Technical details
Already in the database (checked): the five multi-stop fields and `customer_segment` on `courier_vehicle_rates`; the `courier_order_stops`, `courier_order_parcels` and `courier_order_charges` tables; `staff_courier_waive_charge(_charge_id, _reason)`; `courier_setting()`, which reads `ops_settings(key, value)`.

One migration:
- **Change** `staff_courier_upsert_rate`: add `_customer_segment`, `_extra_pickup_fee`, `_extra_drop_fee`, `_max_pickups`, `_max_drops`, `_return_per_km`. The segment cannot change on update. Fees and return per km must be at least 0. Regular rates need both max values at least 1. Permission checks and audit logging stay exactly as they are. The old signature is dropped and replaced, with grants re-applied.
- `staff_courier_confirm_rate`: kept as is (it only clears the placeholder flag).
- **New** `staff_courier_set_setting(_key, _value int)`: only the two keys above are allowed, values 1 to 120, same permission as rates, writes to `ops_settings` and to the audit log with before/after values.
- **New** `staff_courier_verify_stop(_stop_id, _reason)`: only for `courier_is_ops_staff()`. The stop must be 'arrived' and the reason at least 10 characters. For a return stop, it is refused while a linked charge is pending. It reuses the same completion steps as `courier_verify_stop_otp` (parcel updates, `courier_recompute_order_progress`, customer push). It writes a `courier_order_events` row (actor_type 'staff', from/to = current order status, meta with stop_id, reason and manual_verify: true) and an audit_logs row. Before writing, I will read the body of `courier_verify_stop_otp` to copy its exact completion steps.

Code: `src/lib/courier.functions.ts` gets new list queries (stops, parcels, charges, settings, pending-return flag, stop counts) and wrappers for the calls above. `src/components/courier-page.tsx` gets the rate tabs and dialog, the settings card, the list badges and filter, and the detail sections.

In the closing reply, I will list every database function that was created or changed.
