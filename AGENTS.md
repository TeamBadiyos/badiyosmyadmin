<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Generate seal-sticker PDFs entirely in the browser from the existing staff export RPC so no duplicate export backend exists.
- Service-content banner visibility and validation are service-scoped; Auto saves preserve raw unused banner keys and public output excludes them — why: removing controls must not erase historical content or block unrelated saves.
- Render operational order money through the shared payment-summary component so every board uses the same snapshot labels and zero-value rules.
- Agreements: templates are versioned rows (never edited in place); each issued agreement freezes its filled-in text, and PDFs are drawn in the browser from that text (src/lib/agreement-pdf.ts) — why: the signed wording must never change after issue.
- Merchant/Expert app endpoints for agreements, expert self-registration and party notifications are SECURITY DEFINER RPCs (app_*), not server routes — why: those apps talk to the database directly with the user's own login.
- Multi-city: every operational table has city_id (FK cities) filled by the aa_fill_city_id trigger (zone → store → partner → city name → default city); city-wise prices/delivery live in city_price_options / city_service_settings, and staff city scope comes only from staff_allowed_city_ids() — why: one source of truth for city access that RLS and RPCs can share.
- City-wise ops values (slots, bands, Book Now, accept timeouts) live in city_ops_settings; delivery rates/timeouts in city_service_settings; default-city rows mirror to legacy ops_settings/service_settings by trigger — why: existing DB logic keeps working unchanged for Latur.
- City view filter: the top-bar city is saved per staff user (staff_set_view_city) and enforced in the DB — restrictive `cc_city_scope` RLS policies on city-tagged tables, and staff report RPCs owned by the NOBYPASSRLS role `cc_reader` — why: every page, list and report follows the city without per-query filters. New city-tagged tables need the policy; new report RPCs should be owned by cc_reader; new RLS tables need the `cc_reader_all` SELECT policy + grant.
- Clean Home/Auto "no expert accepted" auto-cancel window lives only in city_ops_settings (clean_/wash_auto_cancel_minutes) read via auto_cancel_minutes()/booking_auto_cancel_minutes(); refunds always use total_amount — why: one source for the expiry job, sweepers, apps and Dashboard.
- Booking/order detail panels (Clean, Store/Food, Parcel) are built from the shared pieces in src/components/detail-panel.tsx; actions live only in the bottom ActionBar — why: one layout everywhere. Staff job-time changes go through staff_adjust_booking_time (booking_time_adjustments), which resolve_booking_payouts adds to expert pay.
- Zones are a PostGIS coverage of each city's city_boundaries area (zones.geom; legacy boundary jsonb mirrored by trigger), edited only via zv2_* RPCs on zone_draft_cells; after switch-over each cell keeps live_zone_id and zv2_sync_live mirrors edits/On-Off to zones. All apps resolve location with zone_lookup / app_zone_status; Off zones (is_off until off_until) block new bookings/orders via the a0_zone_off_guard triggers — why: server-guaranteed no overlaps/gaps, one lookup, one Off rule.
- Clean/Wash slot window comes only from service_hours (open → close − <group>_last_slot_before_close_minutes in city_ops_settings) via slot_window(); slot_first/last_start_hour are legacy fallbacks — why: one source for opening hours and slots.
- Clean/Wash cancellations (customer, staff, auto) go through booking_cancel_core + booking_refund_split; wallet parts are credited instantly, online parts are left refund_status=pending for the user.badiyos.com refund job — why: one fee/refund rule set for every cancel path.
- Staff roles are only super_admin / ops_manager / area_partner. Area partners are scoped by restrictive RLS (is_area_partner_staff + staff_my_zone_ids) and read customers only via staff_customer_brief (masked phone) — why: hiding menus is not security.
- Every CC file download is audit-logged by the anchor-click patch in src/lib/export-guard.ts and customer phones in downloads go through exportPhone() — why: one place guarantees raw phones only reach super admin.
