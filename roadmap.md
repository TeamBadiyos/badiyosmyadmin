# Roadmap
- [x] Restore single-flight expired-login recovery without changing connection settings; six tests and simulated browser recovery/login redirect passed. Real-account expiry check unavailable for external Supabase.
- [x] Add audited Super Admin Edit/Delete options for manual adjustments; rolled-back balance, date, provenance, stale-edit, payout protection and permission tests passed.
- [ ] Verify adjustment Edit/Delete through signed-in CC; blocked by external Supabase without an available authenticated session.
- [x] Add manual payout debit/credit adjustment dates with separate audit time; date tests and SQL accounting checks passed.
- [ ] Verify posting a dated adjustment through signed-in CC; blocked by unavailable authenticated verification for external Supabase.

- [x] Training orders broadcast only to selected active trainees; Clean/Auto, Parcel and Store/Food SQL creation/acceptance isolation tests passed with rolled-back fixtures.
- [ ] Verify selected-recipient training offers on real phones and through signed-in CC; blocked by unavailable external-app login/session and physical devices.

- [x] Remove Clean Auto banner controls and public output while preserving unused saved data; public Clean/Wash contracts and validation tests passed (signed-in screen check unavailable).

- [x] Add Seal Sticker batch PDF generation and download dialog.
- [x] Verify 3-label samples visually and decode both colour modes exactly.
- [x] Standardize order-card paid breakdowns across Clean, Car Wash, Courier, and Store.
- [x] Add audited flat-service estimated time editing to Service Catalogue.
- [x] Dashboard final cleanup: simple 4-line cards, 6 team cards + panel, summary table (gross/discount/net/total).
- [x] Clean: separate Book Now switches for Home and Auto (UI + booking checks).
- [x] Clean: separate opening hours for Auto (copy of Clean), wash slots/bookings use Auto hours, Service Status shows both read-only.
- [x] Board cards: instant bookings show "Now"; Done-today cards show amount only (on the way / arrived shown only while in progress).
- [x] Live Ops redesign: Support two-pane chat (ticks, unread, notes, quick replies, assign), SOS chips, Suggestions list-first + More filters, badge, Business trips on Dashboard, Dispatch Alerts → Settings.
