# Food launch progress + Demand "wanted names"

## 1. Food → Settings: Launch progress %
- New box "Launch progress %" (0–100) in Food → Settings, per city. Leave it blank to hide it.
- Customer App gets it from a public function `app_launch_progress('food', _city_id)` → `{ percent: number | null }`. `null` means hidden. Default city is used when the city has no value.

## 2. Demand: wanted hotel/shop names
- Each demand request can carry a list of names ("wanted hotel/shop"). The customer can add more names to their request later. Repeated names on one request are saved once.
- App functions:
  - `submit_demand_request(..., _wanted_names text[] default null)`: adds the names to the new request.
  - `app_demand_add_names(_request_id, _names text[])`: adds names to the customer's own request (signed-in owner only, up to 10 names, 60 characters each).
  - `app_demand_name_suggestions(_city, _service, _q default null)` → `[{ name }]`, top 10 most-requested names. Names only, no phone or customer details. Public.
- Matching names: spaces trimmed, case ignored, and close spellings put together ("Hotel Sai Palace" = "sai palace hotel" ≈ "Sai Pallace"). The most-used spelling is shown.
- Growth → Demand → new "Most requested" tab. Filters: City and Service. Columns: Name, Customers (each counted once), Latest date, Phones (expand to see them all). Export CSV. Ops manager and super admin only, same as Demand today.

## Technical section
- Migration: `city_service_settings.launch_progress_pct smallint null` with a 0–100 validation trigger. `staff_set_city_service` saves it. Add `app_launch_progress`.
- New table `waitlist_wanted_names` (request_id FK, city, service, raw name, `norm_key`, created_at). Unique on (request_id, norm_key). Grants, RLS: staff reads within their city scope (cc_city_scope + cc_reader_all). No direct writes; changes go only through the RPCs.
- Normalised key: lowercase, punctuation removed, common words dropped (hotel, restaurant, shop, store, the), remaining words sorted. Similar spellings are grouped with `pg_trgm` similarity ≥ 0.6 against the leading key in the same city/service. This is done in the report RPC `staff_demand_top_names(_city, _service)`, owned by cc_reader.
- UI: a tab inside `waitlist-page.tsx` with the CSV export pattern it already uses. A server fn goes in `waitlist.functions.ts`. The Food settings field sits in `service-commerce-module.tsx` and saves through `saveServiceSettings`.
- Verify: call the functions for Latur with sample names, read back the grouping, and check that suggestions return no personal data.
- The Customer App must send the names and show the suggestions and progress bar.
