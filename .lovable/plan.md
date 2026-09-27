# Bulk Courier: left-behind packets (read-only)

Nothing changes in the backend, and no new actions are added. All three screens only read data that already exists.

## What was found in the data
- `business_trip_removed_packets` has one row for each removed packet: removal_id, batch_id, courier_order_id, merchant_id, receiver_id, drop_label, code, reason_code, notes, removed_by ('rider' or 'business'), removed_by_id and removed_at.
- `business_left_behind_stats(_merchant_id, _date)` returns `{ total, by_reason: {code: n}, by_actor: {rider|business: n} }`. Ops staff are allowed to call it.
- `courier_trip_packets` only works for the assigned rider, so staff screens will read the history table directly instead.
- The table does not store fare before, fare after or refund. Every removal writes one `courier_order_events` row with `meta.event='packets_removed'`, `codes`, `refund` and `new_total`. The `business_audit` entry also holds `removal_id`, the old order (so the old `total_amount`) and `new_total`/`refund`. The screens will use these.

## 1) Trip detail: "Left behind" section
This goes in the courier order detail for business trips, and in the Bulk Courier trip detail where one exists.
- Removals are grouped by removal_id. Each group shows fare before → fare after and the refund amount. Fare before is the previous total from the audit entry (or the event's new_total plus refund). Fare after is new_total. Refund is refund. An "All packets removed, trip cancelled" removal says so.
- Each packet row shows: sticker number (7-digit codes shown as 104521-7), drop label (C1, C2…), receiver name from `business_receivers`, reason and notes, removed by (the rider's name from `experts`, or "Business") and time.

## 2) Business view card: "Left behind today: N"
- Calls the stats RPC with the business and today's date in IST.
- Shows the split by reason (as small chips) and the rider vs business split.
- Shows a red badge when N is more than 10% of the business's packets today. Today's packets are the batched packets currently on today's trips plus the left-behind count (removed packets are deleted from `business_trip_packets`, so they have to be added back).

## 3) Trip list tag
- The trips query also fetches the left-behind count for each batch_id. Trips with removals get a grey "N left behind" tag.
- Trips keep their `T<no>` labels and drops keep their `C1`, `C2`… labels.

## Technical details
- New server functions in `src/lib/bulk-courier.functions.ts` (behind requireOps): `getTripLeftBehind(courier_order_id)`, `getLeftBehindToday(merchant_id)`, and removed counts added to the existing business trips listing.
- `src/lib/courier.functions.ts`: the trip packet loader also returns the left-behind rows and removals.
- UI changes: `courier-page.tsx` (section), `bulk-courier-page.tsx` (card, tag, badge). Pill tone "off" is used for the grey tag, and a custom red span for the badge.
- Before wiring, check that the RLS on `business_trip_removed_packets` / `courier_order_events` / `audit_logs` lets ops staff read them. If it does not, the server functions use the existing ops-verified pattern and do not change the database.
