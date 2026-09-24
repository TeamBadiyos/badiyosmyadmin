# Reactivate Courier Delivery skill category

## Confirmed current state

- `Courier Delivery` (`250ebe17-dfc8-4d9b-95ef-1f60a9372142`) is currently inactive.
- It is still referenced by 4 partner-skill rows and by 1 courier vehicle type as `required_skill`.
- The Command Center Service Catalogue is filtered to the `clean` segment, so reactivating this category will not make it appear there.

## Change

1. Update only this existing `service_categories` row, setting `is_active = true`.
2. Make no schema, RPC, permission, segment, catalogue-screen, or other category changes.
3. Re-read the row and its five references after the update.

## Verified behavior to report

- `courier_eligible_riders` does **not** inspect `service_categories.is_active`; it matches the vehicle's `required_skill` directly to an approved `partner_skills.service_category_id`.
- Courier dispatch and offers (`courier_dispatch_next`, `courier_start_dispatch`, `courier_offer_respond`, and `courier_rider_offers`) do **not** inspect category activity. Dispatch relies on `courier_eligible_riders`.
- Existing skill approvals are listed and can be approved/rejected without an activity check. However, assigning a skill through `staff_assign_partner_skill` requires the category to be active.
- Expert skill requests through `expert_request_skill` require the category to be active. Public category visibility is also restricted to active categories by RLS, while the Command Center's category picker deliberately retains an inactive category only when an active vehicle requires it.
- The Expert App source is not present in this Command Center repository, so its exact list query cannot be confirmed here; the shared database paths it is expected to use do enforce active categories for discovery/request creation.
