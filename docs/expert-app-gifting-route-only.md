# Expert App: route-only gifting trips

This supersedes the previous gifting photo-proof instructions. Do not apply this exception to other business or parcel orders.

## Detect from the existing rider RPC

Read `courier_trip_packets(_courier_order_id)` after acceptance and when opening/refetching a trip. Gifting returns:

```json
{
  "is_gifting": true,
  "delivery_mode": "route_only",
  "requires_scan": false,
  "requires_otp": false,
  "requires_proof": false,
  "requires_geofence": false,
  "drop_proof_mode": "none",
  "packets": []
}
```

Do not infer gifting from a business name, phone, label, or `source='business'`. Older/non-gifting responses retain the current behavior.

## Rider actions

- Keep offer acceptance, assignment, route map, stop order and navigation unchanged.
- For route-only trips, hide parcel scanning, QR/manual-code entry, OTP fields, camera/gallery proof and proof-location gates at pickup and every drop.
- Show **Mark picked up** at pickup and **Mark delivered** at the next drop.
- Call existing `courier_verify_stop_otp(_stop_id, '', null)` for either action. It now branches internally to route-only completion. An empty OTP is intentional only for server-identified gifting trips.
- No new public RPC is required. `courier_rider_complete_gifting_stop` is internal and cannot be called directly by the app.
- Arrival remains available via `courier_rider_arrive_stop`; completion can also record arrival itself. No location/photo input is needed.
- On success, refetch order, stops and trip data. Advance to the next stop; finish the trip only when all routed stops are resolved.
- Failed-stop reason/notes remain in the existing failure flow; skip the compulsory camera/upload step for gifting. The existing failure-photo call returns `proof_required:false` without storing photos for gifting.
- Existing proof-completion calls also branch safely for gifting, but do not force the rider to collect proof before calling them.
- Preserve original payout calculations; do not add another completion or wallet-credit path.

## Verification in the Expert App

Test an assigned gifting trip with multiple drops: no scan or OTP at pickup, no photo/OTP/geofence at delivery, no skipped earlier stop, correct final delivery state, unchanged route and payout flow. Check an ordinary business trip still shows its existing scans/proof requirements.