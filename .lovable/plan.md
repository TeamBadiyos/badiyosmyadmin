# Service Status + Service Hours — Service Toggle tab ke andar

Courier → Service Toggle tab me do naye section jodenge: upar **Service Status**, uske neeche **Service Hours**. Yeh Command Center ka UI hai. Tables aur RPC Customer App project ke plan me ban rahe hain — **unke exact naam wahi migration se lekar wire karenge, koi naam guess nahi karenge.** Jab tak Customer App ka migration lag na jaye, build shuru nahi hoga.

## 1. Service Status (sabse upar)

Har service ki row par:

- **Dropdown**: Live / Coming Soon / Temporarily Stopped / Hidden.
- **Custom note** English aur Marathi — **default messages pehle se dikhenge** (placeholder nahi, asli default text jo khaali chhodne par customer ko jayega), jaise:
  - Coming Soon: "This service is launching soon." / "ही सेवा लवकरच सुरू होत आहे."
  - Temporarily Stopped: "This service is temporarily paused." / "ही सेवा तात्पुरती थांबवली आहे."
  - Hidden: (customer ko kuch nahi dikhta — note service app me list se hi gayab).
- **Optional "wapas kab shuru hoga"** — date + time, IST.
- Status badalte hi **confirm dialog**: us service + city me chal rahe aur aane wale orders ki ginti, "kuch delete nahi hoga" line ke saath.

**Preset button** (section ke upar): "**Sirf ek live, baaki Coming Soon**" — pehle dialog me **chunein kaunsi service live rahegi** (koi bhi, sirf Local Parcel nahi). Confirm dialog me:
- Live rahne wali service ka naam bada aur highlighted.
- Baaki services ke naam bade aksharon me, har ek ke saamne uski active orders ki ginti.
- Ek hi baar me sabke liye common note daalne ka option.

Save ke baad **Undo** button — lekin **sirf 10 minute tak**; uske baad disabled. Undo dabane se pehle current state dobara check hogi: agar beech me kisi aur ne kisi bhi service ka status badla ho, Undo chalega nahi aur friendly message dikhega — "Beach me kisi ne status badal diya hai, isliye purani halat wapas nahi ho sakti." Audit me Undo alag entry jayega.

## 2. Service Hours (neeche)

1. **Weekly hours** — Somvar se Ravivar, har din open aur close time, "band" switch, aur cutoff time.
   - "Somvar ka time sab din copy karo" button.
   - Validation: close open se baad hona chahiye; galat ho to save block + inline error.
   - **Cutoff label service ke hisaab se** — courier me "Last order time", home service me "Last slot ka end".
2. **Holiday calendar** — single date ya **date range**, reason EN + MR. List me edit/hatao. Beet chuki holidays list se apne aap hatengi (display se; record rehta hai).
3. **Aaj band rakho** — turant band, reason (EN + MR), "**kab tak**" option (aaj raat tak ya chuna hua time). Raat 12 baje IST par apne aap clear. Band hone par button "Wapas kholo" ban jata hai.
4. **After-hours message box** — EN + MR, alag text: band hai / holiday hai / aaj band rakha hai.
5. **Impact count** — har band karne wale action se pehle wahi confirm dialog with order counts.

## 3. Priority rule

Pehle **status**, phir **hours/holiday**. Service Coming Soon / Temporarily Stopped / Hidden ho to hours dekhe bina hi status wala message dikhega. Live hone par hi hours, holiday aur "aaj band" lagu honge.

## 4. "Customer ko kya dikhega" preview

- **Saari services ki ek table**: status, hours ke hisaab se open/band, agla open time, aur final customer message — status-first rule lagakar.
- Language toggle English / मराठी.
- **Test-time picker sirf staff ke liye** (customer app me kabhi nahi), **default abhi ka time**, sab IST me.
- **Devanagari font fallback confirm**: Nunito Sans me Devanagari glyphs nahi hain — Marathi text ke liye font stack me fallback add karenge (jaise `"Nunito Sans", "Noto Sans Devanagari", system-ui, sans-serif`) aur zaroorat padi to Noto Sans Devanagari webfont load karenge, taaki Marathi kabhi dabbe na dikhe.

## 5. Access aur suraksha

- **super_admin**: sab badal sakta hai.
- **ops_manager**: sab dropdown, switch, button aur form **dikhenge par disabled** (hidden nahi), taaki dekh sake par badal na sake.
- Baaki roles: section dikhega hi nahi.
- Role check sirf UI me nahi — **server function aur RPC dono par** (sirf super_admin write).
- Har save `updated_at` bhejega; beech me kisi aur ne badla to save reject + "Kisi ne abhi badla hai, refresh karke dobara dekhiye."
- Har change audit_logs me before/after ke saath, RPC ke andar se.

## Technical notes

- Naye files: `src/components/courier/service-status-section.tsx`, `src/components/courier/service-hours-section.tsx`, `src/lib/service-hours.functions.ts` (authenticated, `requireSupabaseAuth`, role resolve wahi pattern jo `courier.functions.ts` me hai).
- **RPC/table ke exact naam Customer App project ke migration se liye jayenge — guess nahi.** Zaroori honge:
  - service status set (status, note_en, note_mr, resume_at) + bulk/preset variant (undo ke liye previous state return karta ho)
  - weekly hours upsert (service, city, weekday, open, close, closed flag, cutoff)
  - holiday add/update/delete (start_date, end_date, reason_en, reason_mr)
  - closed-today set/clear (reason_en, reason_mr, until)
  - after-hours message upsert (3 types × 2 languages) + default messages
  - combined status read (status + hours + holiday → open/closed, next open, final message) — preview aur customer app dono yahi use karenge
- Impact count ke liye naya RPC nahi: `bookings` + `courier_orders` par scoped count, Service Toggle ke maujooda confirm dialog wala tareeka.
- Auto-clear (midnight IST) DB side — "until" column + read RPC me comparison, ya existing cron; Customer App plan se confirm.
- Sab time storage UTC, display/input IST (`Asia/Kolkata`); preview server RPC se, taaki admin aur customer ka jawab ek ho.
- Styling: Badiyos Green #00B97A, Nunito Sans, 8pt grid, existing card/switch/modal patterns; Marathi text par Devanagari fallback.

## Build order

1. Customer App migration lagne ka wait — RPC naam confirm.
2. Server functions + role gating + updated_at guard.
3. Service Status section + preset (service chooser) + 10-min Undo + state-changed check.
4. Service Hours (weekly → holidays → aaj band → messages).
5. Combined preview table (status-first, IST, Devanagari fallback, default now).
6. Ops manager disabled-view aur audit verify.
