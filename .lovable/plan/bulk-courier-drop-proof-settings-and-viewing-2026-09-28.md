# Bulk Courier: drop proof settings and viewing

No backend changes. Everything uses the live functions and existing columns.

## 1. Business setup — "Delivery proof" card
- **Delivery proof:** OTP (default) / Bill Photo / OTP or Bill Photo.
- **Keep photos for:** 30 / 90 / 180 (default) / 365 days.
- Optional reason, then Save. Super admin and ops manager can edit; others see it read-only.
- Line underneath: "Last changed by <name> · <date>", taken from the audit log entry for this business.

## 2. Global settings (Bulk Courier → Setup)
- "Proof geofence (m)" — default 150.
- "First delivery radius from pin (m)" — default 1000.
- Whole numbers only (10–10,000). Super admin and ops manager.

## 3. Trip detail — each delivered drop
- Tag "Completed via OTP" or "Completed via Photo".
- Photo thumbnails; tap to open full screen.
- Under each photo: capture time, distance from location (e.g. "42 m from pin"), accuracy, and a "Location first time" tag when that drop set the receiver's location.
- Photos load only when the drop is opened, not for the whole trip list.

## 4. Receiver detail (inside the business)
- Small map with two markers: the saved pin and the verified location, plus distance between them.
- "Verified on <date>", or "Not verified yet".
- "Reset location" button → required reason + confirm. Super admin and ops manager only.

## 5. Business view — "First-time locations today: N"
- Counts today's delivered drops where the location was set for the first time.
- Clicking it opens a list: time, receiver, rider, sticker numbers, completed via, distance. Each row opens that drop's photos for a spot check.

## Technical details
Confirmed shapes:
- `staff_set_business_proof_settings(_merchant_id, _drop_proof_mode 'otp'|'bill_photo'|'otp_or_photo', _proof_retention_days 1–3650, _reason)`. Requires ops or super admin. Current values come from `business_profiles.drop_proof_mode` and `proof_retention_days`.
- `staff_reset_receiver_location(_receiver_id, _reason)` clears `verified_lat/lng/at` on `business_receivers`, which also holds the pin `lat/lng`.
- `business_stop_proofs(_stop_id)` returns `{completed_via, completed_at, proofs:[business_delivery_proofs rows]}`. Those rows include `storage_path`, `lat/lng`, `accuracy_m`, `distance_from_pin_m`, `location_unverified`, `captured_at` and `seal_codes`.
- `business_proof_report(_merchant_id, _from, _to, _receiver_id, _limit, _offset)` returns rows with `stop_id`, `completed_via`, receiver and rider names, `seal_codes`, `photo_paths` and `location_unverified`.
- `ops_settings` keys `proof_geofence_m` and `proof_first_delivery_radius_m` can be read and updated by staff via RLS. The update runs directly on these two keys, with the write logged in the audit log.

Choices:
- "Location first time" = `location_unverified = true`. That is the backend flag set when no verified location existed yet. The first-time count is today's (IST) `business_proof_report` rows with this flag.
- Photos: none of the storage rules let staff read the `delivery-proofs` bucket. So after `business_stop_proofs` confirms access, a server function signs the returned paths with the admin client (10-minute links). Only those paths are signed.
- "Last changed by": latest `audit_logs` row with action `staff_set_business_proof_settings` for this business, joined to the staff name.
- Map: the existing `loadGoogleMaps` loader with two markers.
- New server functions go in `src/lib/bulk-courier.functions.ts`. The UI goes in `bulk-courier-page.tsx` and the courier order detail's business-trip drop view in `courier-page.tsx`.
- Access: writes use `canOperate`; the server wrappers use `requireOps`.
