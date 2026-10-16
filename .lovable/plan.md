# Top banner rebuild: images by time + text by state

Applies to Clean Home and Clean Auto → Settings → App content. Works per city with a default fallback, and every change is audit logged as it is today.

## 1. Banner images by time (slabs)
- A list of slabs. Each slab has: From, To (24h, can cross midnight such as 19:00–05:00), an image (1080×600, saved as WebP), a text colour (Light/Dark) and an optional label.
- Controls: [+ Add slab], ▲▼ to reorder, Delete.
- Save is blocked if two slabs overlap or a slab has From = To. Overlaps count minute by minute, including slabs that cross midnight.
- A yellow warning lists uncovered times (for example "02:00–05:00 has no image"). Saving is still allowed.
- Defaults: 05:00–10:00 Sunrise (Light), 10:00–17:00 Day (Dark), 17:00–19:00 Evening (Light), 19:00–05:00 Night (Light).
- Existing photos move into the new slabs:
  - Sunrise slab ← current "Sunrise" photo
  - Night slab ← current "Night" photo
  - Day slab ← current "Open, available" photo
  - Evening slab starts empty

## 2. Banner text by state (EN + मराठी title and sub-line)
| State | Title | Sub-line |
|---|---|---|
| Open, expert free | {greeting}, {name} 👋 | ⚡ Maid available now / ⚡ मावशी आता उपलब्ध (Wash: ⚡ Washer available now / ⚡ वॉशर आता उपलब्ध) |
| Open, busy | Busy right now ⏳ / सध्या सर्व व्यस्त ⏳ | Next free slot {next_slot} / पुढील स्लॉट {next_slot} |
| Closed | {greeting} | Book now · slots open {day} at {open_time} / आत्ताच बुक करा · स्लॉट {day} {open_time} पासून |
| Holiday | Holiday today 🎉 / आज सुट्टी 🎉 | Back {day} at {open_time} · book now / {day} {open_time} पासून परत · आत्ताच बुक करा |

- Allowed placeholders: {greeting} {name} {day} {open_time} {next_slot}. Any other placeholder is rejected, both on screen and on the server when saving.
- Saved text carries over from the old boxes: Open available → Open free, Open busy → Busy, Holiday → Holiday. "Closed" uses the new default because the old Night and Sunrise text was split by time.

## 3. Campaign
- No change: image, text, link, start and end.
- While a campaign is active, it overrides both the slab image and the state text.

## 4. Removals
- Remove the 5 fixed state boxes and the "Morning switch time" field once the content above has been migrated.

## 5. Live preview
- A time picker (HH:MM) and a state picker (Free / Busy / Closed / Holiday), plus a "Campaign active" toggle.
- The phone preview shows the matching slab image, text colour and filled-in sample text (for example "Good morning, Rahul").

## 6. Customer App output (app_service_content)
```text
banner: {
  slabs: [{ from:"05:00", to:"10:00", label, image_url|null, text_color:"light"|"dark" }],
  texts: { open_free:{title,title_mr,subline,subline_mr}, open_busy:{...}, closed:{...}, holiday:{...} }
}
campaign: { ...unchanged, active }
```
- The old `banners` and `hero.morning_switch_time` stop being returned. The app picks the slab for the current time and the text for the current state.

## Technical details
- `src/lib/service-content.ts`: new types `Slab` and `BannerTexts`. `normalize` migrates the old `banners` and `morning_switch_time` into slabs and texts. `validate` checks for overlaps (per-minute coverage with midnight wrap), an `uncoveredRanges()` helper finds gaps, and placeholders are checked. Tests cover: overlap rejected, midnight-crossing slab accepted, gap reported, unknown placeholder rejected, old data migrated to the 4 default slabs.
- `src/components/service-app-content.tsx`: replace BannerFields and the morning-time input with a slab editor and a state-text editor; add preview pickers. Slab images use the existing WebP upload at 1080×600.
- Migration: `staff_save_service_content` validates slabs and placeholders on the server. A one-time update rewrites saved `clean_content`/`wash_content` rows into the new shape (old keys removed). `app_service_content` returns `banner` + `campaign`, with built-in defaults when nothing is saved.
