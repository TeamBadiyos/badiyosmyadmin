# Play Store download live karna — saara "Coming Soon" hatana

## Goal
Marketing site se app-related "Coming soon" poori tarah hatao. App ab Play Store par live hai — har jagah proper "Download on Google Play" button jo is link par jaye:
`https://play.google.com/store/apps/details?id=com.badiyos.customer&pcampaignid=web_share`

Link backend (database) me store hoga, frontend hardcode nahi — baad me badalna ho to sirf DB update.

## Database (migration)
1. `app_config` me naya column `play_store_url text` + value set: upar wala Play Store link.
2. `app_config` par anonymous read policy (sirf SELECT, sirf ye public config row) taaki logged-out visitors ko bhi button mile — existing policies ke saath conflict check karke.
3. Koi table delete nahi.

## Backend
- Naya public server fn `getPlayStoreUrl()` (koi auth nahi) — `app_config` se URL padhta hai; fallback: wahi Play Store link agar row/column empty ho.

## Frontend changes

### `src/components/marketing/shell.tsx`
- `ComingSoonAppButton` ko replace karo naye `PlayStoreButton` se: green pill button, Play icon + "Download on Google Play", `href` = DB se aaya URL, `target="_blank"`. Props same (`dark`) taaki saari jagah drop-in ho.
- Header me ab yahi button dikhega (pehle disabled "App — Coming Soon" tha).
- Services dropdown me "Soon" tags hatao (Home Services, Shop Local).

### `src/routes/index.tsx`
- Hero: `ComingSoonAppButton` → `PlayStoreButton` (DB URL se).
- `DownloadApp` section: heading "The Badiyos app is here", copy update ("Book, pay, track — download the Android app"), center me bada Play Store button, neeche ki "Coming soon on Android…" line hatao (WhatsApp line optional rakhein: "Need help? Chat with us on WhatsApp").
- Meta description / og:description se "coming soon" hata kar reword.
- Service group cards se "Coming Soon" badge hatao; "We're expanding soon" strip ka text neutral karo ("Don't see your service? Show your interest…") — interest dialog waise hi rahega.
- FAQ ka "app is launching shortly" answer update: app live hai, Play Store se download karo.

### `src/routes/_authenticated/dashboard.tsx`
- Internal fallback text "Coming soon" → "Select a section from the sidebar" (admin panel ke andar ka akhri instance).

## Notes
- "We'll notify you / reach out soon" jaise normal English phrases (lead form confirmations) same rahenge — wo launch messaging nahi hai.
- Support page (`/support`) ka answer pehle se "in the Badiyos app…" bolta hai — wo already correct hai.
- Verify: tsgo + preview me homepage par button click karke Play Store khulna check.
