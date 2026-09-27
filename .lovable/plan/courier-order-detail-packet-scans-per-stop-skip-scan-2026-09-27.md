# Courier order detail: packet scans per stop + Skip scan

Only for business trips (orders that have rows in `business_trip_packets`). Other orders look exactly as today.

## What you will see
In the order detail's **Route** section, each stop of a business trip gets one extra line:
- Pickup stop: "Packets scanned at pickup: X / Y" (all packets on the trip).
- Drop stop: "Packets scanned at drop: X / Y" (packets for that drop).
- A **Skip scan** button (super admin and ops manager only) when some packets at that stop are not scanned yet. It opens a reason box (required). Confirm asks "Skip packet scanning for this stop?" and then calls `staff_courier_skip_scan`. A success toast shows and the counts refresh. If the backend refuses, its message is shown.

Nothing else changes.

## Technical details
- `src/lib/courier.functions.ts`:
  - New `listOrderPackets(orderId)`: reads `business_trip_packets` (id, drop_stop_id, scanned_pickup_at, scanned_drop_at) for the courier order, staff-gated like the other detail reads.
  - New `skipStopScan({ stopId, reason })`: super admin / ops manager check, then `rpc("staff_courier_skip_scan", { _stop_id, _reason })`. Reason trimmed, must not be empty.
- `src/components/courier-page.tsx` (stops section of the detail): load packets with a query; if there are any, compute counts per stop (pickup = all packets / scanned_pickup_at set; drop = packets with that drop_stop_id / scanned_drop_at set); render the line and button reusing the existing reason/confirm pattern of "Verify manually". Button hidden for other roles.
