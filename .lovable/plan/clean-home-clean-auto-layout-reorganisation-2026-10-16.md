# Clean Home & Clean Auto — layout reorganisation

Same layout for both services. All saved values, keys and app behaviour stay the same. The only data change is removing "First/Last slot starts at" (point 5).

## 1. Tabs
Bookings · Services · Slots · Team · Training (Clean Home only) · App content · Settings.
Clean Auto gets the new App content tab. It still has no Training tab.

## 2. App content tab
- Moved out of Settings into its own tab.
- 4 collapsible sections, all closed at first: **Hero & cards**, **Price options**, **Details sheet**, **Top banner** (Clean Home only).
- The live phone preview stays fixed on the right.
- Same Save button and city/default banner as today. Old read-only legacy content block stays at the bottom until 2026-11-15.

## 3. Slots tab
Top of the tab, above the slot grid: **Automatic capacity**, **Count source**, **Time bands** (moved from Settings, unchanged).

## 4. Settings tab — left mini-menu, each section with its own Save
- **Timings**
  - "Open every day [from] – [to]": one time used for all days.
  - "Weekly off": day chips.
  - "Different time on some days": closed at first. Opens a per-day override table.
  - "Last slot before closing": minutes.
  - "Close today" button.
  - Holidays list.
- **Booking rules:** 'Now' slot, slot gap, dispatch lead, buffer between jobs, auto-cancel minutes, service extension.
- **Expert rules:** On the way / Arrived steps, ASAP on-the-way within, Scheduled on-the-way before slot, remind expert, warn before slot.
- **Customer messages:** capacity default message plus situational messages.

On a narrow screen, the left menu becomes a row of chips across the top.

## 5. One source for slot times
- Remove "First slot starts at" and "Last slot starts at".
- First slot = opening time.
- Last slot = closing time − "Last slot before closing".
- Migrating current Latur values: Clean Home 10 AM–7 PM. Clean Auto starts at 9 AM; its closing time is read from the current data during the build. Opening hours are set so the slot range stays exactly what customers see today. "Last slot before closing" starts at 0, unless today's hours and last slot differ. In that case it is set to the difference.
- Before changing anything, I'll check today's hours against the first/last slot values for every city. If they don't agree, I'll show you before overwriting.

## 6. Auto-cancel shows empty
The field shows "Now: – min" when the value doesn't load. The cause isn't confirmed yet. The first step is to reproduce it signed in and check what the server returns for Latur. Then I'll fix it so the field shows and saves the current value (Latur 120).

## 7. Labels
Each setting gets one short plain-English line under its label. All labels are reviewed so they use consistent English, with no Hinglish.

## Technical details
- `dashboard.tsx`: add `maid-app-content` / `wash-app-content` nav keys and add them to the group key lists. Settings renders a new `CleanSettingsPage` (left menu), and Slots renders `CleanCapacitySettings` above `SlotAvailabilityTab`.
- `service-app-content.tsx`: wrap the existing blocks in collapsible sections (shadcn Collapsible). Make the preview column `sticky`.
- `booking-timings-tab.tsx`: split into Booking rules and Expert rules panels, each with its own save of only its own keys. Move the 'Now' slot, auto-cancel and extension controls out of `slot-availability-tab.tsx`, without changing their server calls.
- Timings panel: a new simple editor that writes the existing `service_hours` rows (all 7 days the same; weekly off = closed days; overrides edit single days). Holidays and Close today reuse the existing `service_holidays` / mark-closed calls.
- Migration:
  - Add the per-city/service key `last_slot_before_close_minutes` in `city_ops_settings`.
  - Update the slot-generation functions (`app_service_hours`, `app_fully_booked_slots` and the slot/capacity helpers that read `slot_first_start_hour` / `slot_last_start_hour`) to work out slots from `service_hours` and the new key.
  - Keep the old keys stored but stop reading them.
  - Public response field names stay the same.
- Auto-cancel: verify `getAutoCancelMinutes` → `app_auto_cancel_minutes(group, city)` for Latur. Likely fixes are a query key/city mismatch or a 'clean'/'wash' service-key mismatch.
- Tests: slot range from hours (10:00–19:00, last-slot minutes 0 and 60), and auto-cancel read returns 120 for Latur.
