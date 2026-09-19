# Catalogue: inline activate/deactivate toggles

Problem: on the Service Catalogue screen, a segment ("badiyos Courier") and its category ("Courier Delivery") show an INACTIVE badge, but there is no way to turn them on from the list. The only control is a hidden "active" checkbox inside the Edit modal, and segments have no control on this screen at all.

## What changes

1. **Segment row** — add an on/off switch next to the "+ Category" button in each segment header. Uses the existing `setSegmentActive` server function (already staff-gated, super_admin + ops_manager).
2. **Category row** — add an on/off switch next to Availability / Edit / + Service. Uses the existing `setCategoryActive` server function.
3. **Confirm on switch-off** — turning a segment or category off shows a confirm dialog telling the user how many active services sit under it ("This will hide N services from the app"). Switching on applies immediately.
4. **Success/error feedback** — sonner toast on success/failure, list refreshes after each change.
5. **Access** — same rules as the existing Edit buttons on this screen (staff roles that can edit the catalogue); read-only roles don't see the switches.

## Technical notes

- Files changed: `src/components/service-catalogue-page.tsx` (toggle UI + confirm dialog), possibly `src/lib/catalogue.functions.ts` only if a thin `setSegmentActive` wrapper is needed there — otherwise reuse `@/lib/segments.functions`.
- No database changes; `is_active` columns and the server functions already exist.
- Switching a segment/category off does NOT delete anything — services stay intact and reappear when switched back on.
