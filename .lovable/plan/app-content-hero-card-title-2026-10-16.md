# App content → Hero: "Card title"

Add a "Card title" field (English + मराठी) to the Hero section of App content in Clean Home and Clean Auto → Settings. This is the name on the small service card on the Customer App's Clean tab.

- Defaults: Clean Home "Maid" / "मेड"; Clean Auto "Car Wash" / "कार वॉश".
- Works per city, falling back to the default like every other App content field. Saves are audited.
- The live phone preview shows the card title.
- If the field is left blank, the app gets the default text.

## For the Customer App
`app_service_content` → `hero` gains two fields:
```text
hero: { ..., card_title: string, card_title_mr: string }
```

## Technical details
- `src/lib/service-content.ts`: add `card_title` / `card_title_mr` to `Hero`, with per-service defaults in `normalizeServiceContent`. English is required when saving. Add one test for the defaults.
- `src/components/service-app-content.tsx`: add the two inputs in the Hero section and show them in the preview.
- Migration: update the `app_service_content` hero output with the defaults above, and update the `staff_save_service_content` length check (max 30).
