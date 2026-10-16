# One "Delivery rate" card for Store, Food and Parcel

## What you will see
In Store, Food and Parcel settings (per city) the same "Delivery rate" card, same fields in the same order:

1. Vehicle — Store/Food: Bike (fixed). Parcel: a row per vehicle it uses.
2. Base fare ₹
3. Included km
4. Per km ₹ (after included km)
5. Min fare ₹
6. Platform fee ₹
7. Rider share %

Under each row a live example, e.g. "5 km → ₹30 + 3 × ₹10 = ₹60 · rider gets ₹42".

- Parcel "Commission %" becomes "Rider share %" everywhere (settings, reports, payouts, Partners/Agreements labels). Stored values are converted: rider share = 100 − commission. Latur Parcel Bike regular 30% → 70%; corporate 50% → 50%.
- "Accept timeout" leaves the rate card and moves to each service's Booking rules (Latur: Store 10 min, Food 5 min, Parcel keeps its current value).

## Fee formula (Store, Food and Parcel identical)
```text
fee = max(Min fare, Base fare + max(0, km − Included km) × Per km) + Platform fee
```
Latur Store/Food defaults: Base ₹30, Included 2 km, Per km ₹10, Min ₹30, Platform fee ₹0.

## Latur Store order — before vs after
Today Store/Food use: max(Min ₹30, km × ₹10).

| Distance | Before | After |
|---|---|---|
| 1 km | ₹30 | ₹30 |
| 3 km | ₹30 | ₹40 |
| 6 km | ₹60 | ₹70 |

Food changes the same way. Parcel prices do not change (it already uses this formula).

## Rider pay
Rider payouts for Store/Food are not changed (standing rule). The Store/Food "Rider share %" field shows today's rider share (75%), so the example line matches what riders actually get. Parcel rider pay is unchanged in money terms — only the label and stored number flip.

## Technical details
- Add `delivery_base_fare`, `delivery_included_km`, `delivery_platform_fee`, `rider_share_pct` to `city_service_settings` (and legacy `service_settings` mirror); seed Latur store/food as above.
- Update the Store/Food delivery quote function (currently `greatest(min_fare, km × per_km)`) to the shared formula; one SQL helper `delivery_fee_calc(...)` used by both Store/Food quote and Parcel quote.
- Rename `courier_vehicle_rates.commission_pct` → `rider_share_pct` with value conversion in one migration; update every DB function, report RPC and payout calc that reads it (rider pay = fare × share/100 instead of fare × (100 − commission)/100), so payouts are identical.
- New shared `DeliveryRateCard` component used in store-settings, service-commerce-module and courier-page; accept timeout moved into Booking rules sections.
- Unit test: formula gives ₹30/₹40/₹70 for 1/3/6 km with Latur defaults, and rider-share conversion 30 → 70.
- Customer/Merchant apps showing fees read the server quote, so they follow automatically.
