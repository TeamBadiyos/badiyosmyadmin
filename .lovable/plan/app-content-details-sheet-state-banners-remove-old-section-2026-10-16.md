# App content: Details sheet, state banners, remove old section

Applies to Clean Home and Clean Auto → Settings → App content. Every text has English + मराठी, saved per city with default fallback, shown in the live phone preview, images compressed to WebP, every save audited (same as the existing editor).

## 1. Details sheet
- Section title for the included list (default "The expert will do" / "एक्सपर्ट हे करेल").
- Section title for the excluded list (default "Not included" / "यात समाविष्ट नाही").
- Note box: text + small icon (pick from a short icon list, or upload a small image). Default Maid: "Please keep cleaning supplies ready at home" / "कृपया घरी स्वच्छतेचे साहित्य तयार ठेवा". Wash default: "Please keep water and parking access ready" / "कृपया पाणी आणि पार्किंगची सोय तयार ठेवा" (my wording — please confirm or replace).
- Note box can be turned off (blank text = hidden).

## 2. Top banner, one per state
Five fixed states, each with background image (1080×600 hint, WebP), title and sub-line (EN + मराठी):

| State | Title default | Sub-line default |
|---|---|---|
| Open, available | {greeting}, {name} 👋 | ⚡ Maid available now (Wash: ⚡ Washer available now) |
| Open, busy | All experts are busy | Next slot {next_slot} |
| Closed, evening | Closed for today 🌙 | Book for tomorrow · slots open {day} {open_time} |
| Closed, early morning | Good morning ☀️ | Today's slots open at {open_time} · book now |
| Holiday | Holiday today | Back {day} |

- Helper chips under each field insert placeholders: {greeting}, {name}, {open_time}, {day}, {next_slot}. Unknown placeholders are rejected on save.
- Preview has a state switcher and fills placeholders with sample values.
- Optional campaign banner: on/off, image, title, sub-line, link (uses the existing searchable link picker), start and end date/time. While active it replaces the open-state banners (available and busy); end must be after start.
- Marathi defaults will be my translations — please check them.

The Customer App picks the state and fills the placeholders; the server just returns the content and the campaign's dates (plus an `active` flag computed now in IST).

## 3. Remove the old section
- Remove "App content (old app version)" from the Clean Home settings screen only.
- Old saved data and `app_clean_media` stay untouched and keep working read-only. Staff save/reset for the old format is turned off so nothing changes it.
- I'll add a note with the removal date (30 days: after 15 Nov 2026) so it can be deleted then. Nothing is deleted now.

## Technical details
- `src/lib/service-content.ts`: extend `ServiceContent` with `details: { included_title, included_title_mr, excluded_title, excluded_title_mr, note, note_mr, note_icon }` and `banners: { open_available, open_busy, closed_evening, closed_morning, holiday }` each `{ image_url, title, title_mr, subline, subline_mr }`, plus `campaign: { enabled, image_url, title, title_mr, subline, subline_mr, link, starts_at, ends_at }`. Defaults, normalization (old saved rows get defaults), validation (placeholder whitelist, lengths, campaign dates) + tests.
- `src/components/service-app-content.tsx`: new "Details sheet" and "Top banner" panels, preview state switcher.
- Migration: update `staff_save_service_content` validation and `app_service_content` to return `details`, `banners`, `campaign` (with `active` boolean) — existing keys unchanged. Disable `staff_save_clean_media` / reset writes (raise "retired"); `app_clean_media` unchanged.
- `src/routes/_authenticated/dashboard.tsx`: drop `<CleanAppContent />` from maid-settings.
- New response keys added to `app_service_content`:
```text
details: { included_title, included_title_mr, excluded_title, excluded_title_mr, note|null, note_mr|null, note_icon|null }
banners: { open_available|open_busy|closed_evening|closed_morning|holiday: { image_url|null, title, title_mr, subline, subline_mr } }
campaign: { enabled, active, image_url|null, title, title_mr, subline, subline_mr, link|null, starts_at|null, ends_at|null }
```
