# Multiple zones per person (Experts + Staff)

Today an Expert and a Staff user can each belong to only one zone. Area Partners already support many zones. This brings the same multi-zone behaviour to Experts and Staff users, working like the multi-skill chips.

## What you'll see

**Experts**
- In the Expert form and the Expert details panel, zones become a chip/checkbox picker instead of a single dropdown.
- One zone is marked "Primary" (used wherever a single home zone must be shown, e.g. payouts and reports grouping).
- The Experts list shows all assigned zones and can be filtered by any of them.

**Staff (Roles & Permissions)**
- Adding or editing a staff member lets you tick several zones.
- An Area Partner staff login then sees Experts, Bookings and Reports for every zone they cover, not just one.

**Effect on jobs (full effect, as chosen)**
- Zone-scoped listings, filters, capacity checks and waitlist notifications treat every assigned zone as the person's area.
- Proximity dispatch stays radius-based as it is today; where a zone check exists, it now accepts any of the person's zones.

## Technical plan

New join tables (no columns removed; existing `zone_id` stays as the primary zone so nothing breaks):

- `public.expert_zones (id, expert_id, zone_id, is_primary, created_at)` — unique on (expert_id, zone_id), partial unique index for one primary per expert.
- `public.staff_user_zones (id, staff_user_id, zone_id, created_at)` — unique on (staff_user_id, zone_id).
- Grants: `SELECT` to `authenticated`, `ALL` to `service_role`; RLS on; staff read via `is_active_staff`, writes only through RPCs.

Backfill: insert one row per existing `experts.zone_id` / `staff_users.zone_id` as primary.

New audited SECURITY DEFINER RPCs (mirroring `staff_set_partner_zones`, writing before/after to `audit_logs`):
- `staff_set_expert_zones(_expert_id uuid, _zone_ids uuid[], _primary uuid)` — also syncs `experts.zone_id` to the primary.
- `staff_set_staff_user_zones(_staff_user_id uuid, _zone_ids uuid[])` — super_admin only; syncs `staff_users.zone_id` to the first zone.

Scope helper: `public.staff_zone_ids(_auth_user_id uuid) returns uuid[]` returning the staff member's zone set (join table, falling back to `zone_id`).

Functions/queries updated to use the zone set instead of a single id:
- `src/lib/experts.functions.ts` — area_partner scoping `eq("zone_id", …)` becomes `in("zone_id", zoneIds)`; expert rows return `zoneIds`/`zoneNames`; `staff_upsert_expert` payload accepts a zone array.
- `src/lib/bookings.functions.ts`, `src/lib/reports.functions.ts`, `src/lib/offers.functions.ts` (`offers_caller_city`) — zone scoping widened to the set of assigned zones/cities.
- `staff_generate_payout_batch`, `notify_waitlist_for_expert` — match an expert against any assigned zone.
- `src/lib/staff.functions.ts` — `createStaffUser` / `updateStaffUser` accept `zone_ids`, validate at least one for `area_partner`, and call the new RPC; list returns `zoneNames[]`.

UI files touched: `src/components/expert-form-modal.tsx`, `src/components/expert-details-modal.tsx`, `src/components/experts-page.tsx`, `src/components/roles-page.tsx` — reusing the existing multi-select chip pattern from `area-partner-details-modal.tsx`.
