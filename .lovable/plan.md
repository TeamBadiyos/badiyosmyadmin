# Service Status + Service Hours — Service Toggle tab ke andar

Courier → Service Toggle tab me do naye section jodenge: upar **Service Status**, uske neeche **Service Hours**. Yeh Command Center ka UI hai. Tables aur RPC Customer App project ke plan me ban rahe hain — unke exact naam wahi se lekar wire karenge, koi naam guess nahi karenge. Jab tak naam confirm nahi, screen read-only placeholder dikhayegi.

## 1. Service Status (sabse upar)

Har service ki row par:

- **Dropdown**: Live / Coming Soon / Temporarily Stopped / Hidden.
- **Custom note** English aur Marathi — khaali chhoda to har status ka default message chalega.
- **Optional "wapas kab shuru hoga"** — date + time, hamesha IST.
- Status badalte hi **confirm dialog**: us service + city me abhi chal rahe aur aane wale orders ki ginti, "kuch delete nahi hoga" line ke saath.

**Preset button** (section ke upar): "Sirf Local Parcel live rakho, baaki Coming Soon" — ek click me sabhi services Coming Soon, Local Parcel Live. Ek hi baar me sabke liye common note daalne ka option, confirm dialog (kitni services badlengi + active orders), aur save ke baad **Undo** (purani halat wapas, wahi RPC se, audit me alag entry).

## 2. Service Hours (neeche)

1. **Weekly hours** — Somvar se Ravivar, har din open aur close time, "band" switch, aur cutoff time.
   - "Somvar ka time sab din copy karo" button.
   - Validation: close time open se baad hona chahiye; galat ho to save block aur inline error.
   - **Cutoff ka label service ke hisaab se** — courier me "Last order time", home service me "Last slot ka end".
2. **Holiday calendar** — single date ya **date range**, reason English + Marathi. List me edit/hatao. Purani (beet chuki) holidays list se apne aap hat jayengi (sirf display se; record rehta hai).
3. **Aaj band rakho** — turant band, reason (EN + MR), aur **"kab tak"** ka option (aaj raat tak ya chuna hua time). Raat 12 baje IST par apne aap clear. Band hone par button "Wapas kholo" ban jata hai.
4. **After-hours message box** — EN + MR, alag text: band hai / holiday hai / aaj band rakha hai.
5. **Impact count** — har band karne wale action se pehle wahi confirm dialog with order counts.

## 3. Priority rule

Pehle **status**, phir **hours/holiday**. Matlab service Coming Soon / Temporarily Stopped / Hidden hai to hours aur holiday dekhe bina hi customer ko status wala message dikhega. Live hone par hi hours, holiday aur "aaj band" lagu honge. Preview dono ko milakar ek hi final jawab dikhayega.

## 4. "Customer ko kya dikhega" preview

- Abhi ke hisaab se: service khuli/band, agla khulne ka time, aur exact customer message.
- Language toggle English / मराठी.
- **Test-time picker sirf staff ke liye** (customer app me kabhi nahi), aur har time IST me dikhega aur IST me hi bheja jayega.
- Marathi text ke liye Devanagari font fallback, taaki dabbe na dikhein.

## 5. Access aur suraksha

- **super_admin**: sab badal sakta hai.
- **ops_manager**: sirf dekh sakta hai — sab dropdown, switch, button disabled.
- Baaki roles: section dikhega hi nahi.
- Role check sirf UI me nahi — **server function aur RPC dono me**.
- Har save `updated_at` bhejega; agar beech me kisi aur ne badla to save reject hoga aur "kisi aur ne abhi badla hai, refresh karke dobara dekhiye" dikhega.
- Har change audit_logs me before/after ke saath, RPC ke andar se.

## Technical notes

- Naye files: `src/components/courier/service-status-section.tsx`, `src/components/courier/service-hours-section.tsx`, aur `src/lib/service-hours.functions.ts` (authenticated, `requireSupabaseAuth`, role resolve wahi pattern jo `courier.functions.ts` me hai).
- Customer App project se chahiye exact RPC/table naam:
  - service status set (status, note_en, note_mr, resume_at) + bulk/preset variant
  - weekly hours upsert (service, city, weekday, open, close, closed flag, cutoff)
  - holiday add/update/delete (start_date, end_date, reason_en, reason_mr)
  - closed-today set/clear (reason_en, reason_mr, until)
  - after-hours message upsert (3 message types × 2 languages)
  - combined status read (status + hours + holiday → open/closed, next open, final message) — preview aur customer app dono yahi use karenge
- Impact count ke liye naya RPC nahi: `bookings` + `courier_orders` par scoped count, wahi tareeka jo Service Toggle ke maujooda confirm dialog me hai.
- Auto-clear (midnight IST) DB side ho — UI par bharosa nahi; "until" column + read RPC me time comparison, ya existing cron. Yeh bhi Customer App plan se confirm karna hai.
- Sab time storage UTC me, display/input IST me (`Asia/Kolkata`), preview server RPC se aata hai taaki admin aur customer ka jawab ek ho.
- Styling: Badiyos Green #00B97A, Nunito Sans, 8pt grid, existing card/switch/modal patterns.

## Build order

1. Customer App se RPC naam confirm.
2. Server functions + role gating + updated_at guard.
3. Service Status section + preset + undo.
4. Service Hours (weekly → holidays → aaj band → messages).
5. Combined preview (status-first rule, IST, Devanagari fallback).
6. Ops manager read-only aur audit verify.
