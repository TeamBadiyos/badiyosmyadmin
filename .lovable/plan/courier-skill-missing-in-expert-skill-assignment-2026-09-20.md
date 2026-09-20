# Courier skill missing in Expert skill assignment

## What is happening

The "Select category…" dropdown on an expert's profile only lists **active** categories.

Verified in the database:
- Segment "badiyos Courier" — inactive
- Category "Courier Delivery" — inactive
- Vehicle type "Bike" already requires the "Courier Delivery" skill

So courier rider matching (`courier_eligible_riders`) needs experts approved for "Courier Delivery", but that skill cannot be assigned because the category is switched off.

## Fix

1. Activate the segment "badiyos Courier" and the category "Courier Delivery" (data change only, through the existing staff-gated toggles — no schema change).
2. Make the skill dropdown resilient: keep listing active categories, but also include any category that is referenced as a `required_skill` by an active courier vehicle type, so a courier skill can always be assigned even if the customer-facing category is turned off. Inactive ones show a small "inactive" note in the option label.
3. Sanity pass over the courier skill chain after the change:
   - vehicle type -> required skill -> `partner_skills` approved row -> `courier_eligible_riders`
   - confirm assigning "Courier Delivery" to an expert produces an approved skill row and that the expert then passes the eligibility check.

## Files

- `src/lib/partner-skills.functions.ts` — extend `listActiveServiceCategories` to also return courier-required categories (with an `isActive` flag).
- `src/components/expert-details-modal.tsx` — render the flag in the option label; no other behaviour change.
- Data update: activate the courier segment and category.

## Note

Courier zone mapping is still empty, so courier orders will fail area validation until zones are mapped in Courier -> Zone Mapping. That is separate from this skill fix.
