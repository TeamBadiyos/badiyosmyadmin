# Campaigns tab — "SENT" ka matlab, aur usko sach dikhane ka plan

## 1. Abhi ho kya raha hai (aapke sawaal ka jawab)

Ye tab customers ko **mobile app ka notification (push)** bhejne ke liye hai — coupon/offer announce karna, ek hi baar me sabko ya sirf ek shehar ke customers ko.

Aapke campaign "Get 1st Booking Free" me:

- Audience = `delivery`, isliye system ne un customers ko chuna jinka pata (address) us naam se match hua — total **7 log**, jinke naam aur number modal me dikh rahe hain.
- Bhejne ka zariya sirf **app ka push notification** hai. WhatsApp ya SMS nahi jata.
- Har naam ke aage jo **SENT** likha hai uska matlab abhi sirf itna hai: "is customer ka app-device registered tha aur push bhej diya gaya". Ye confirm **nahi** karta ki notification unke phone tak pahuncha ya nahi — Google (FCM) ka jawab kahin record nahi hota.
- Jiska koi device registered na ho uske aage "failed — No registered device" aata.

To problem ye hai: label bharosa dila raha hai ki pahunch gaya, jabki wo sirf "bhej diya" hai.

## 2. Kya theek karenge

**A. Sach wala status**

Teen saaf status honge:

- **Queued** — bhejne ke liye nikala gaya
- **Delivered** — Google ne accept kiya (phone tak pahuncha)
- **Failed** — kaaran ke saath: "app install nahi / device registered nahi", "purana device token", "Google ne reject kiya"

Push bhejne wala hissa ab har customer ka asli result wapas likhega, isliye modal me jo dikhega wo actual hoga.

**B. Modal me poori jaankari**

Upar ek line: kis audience ko gaya (All customers / shehar ka naam), kis zariye se gaya (App notification), kab gaya, aur ginti — Delivered / Failed. Neeche list me har naam ke aage status + fail hone ka kaaran. Failed logon ki CSV export bhi.

**C. Bhejne se pehle preview**

"Send now" dabane se pehle ek confirm box: "X customers chune gaye, inme Y ke paas app registered hai — sirf unhe notification jayega. Baaki Z tak nahi pahunchega." Isse galat audience par bhejna ruk jayega.

**D. Audience saaf karna**

Abhi audience box me kuch bhi type ho sakta hai (isi se "delivery" jaisa value aa gaya, jo shayad shehar nahi tha). Ab audience dropdown hoga: **All customers** ya database me maujood **shehar ki list** me se ek — free text nahi.

## 3. Jo is plan me nahi hai

WhatsApp/SMS channel, scheduling, aur "kisne notification khola" (open tracking) — ye abhi nahi. Bataiye to alag se plan bana denge (open tracking ke liye mobile app me bhi badlav chahiye).

## 4. Technical

- `campaign_deliveries.status` values: `queued` | `delivered` | `failed`; purani `sent` rows ko ek migration me `delivered` map karenge (7 rows). `error` column me reason.
- `staff_send_campaign` ab har user ke liye `queued` row insert karega, phir push bhejega; push ka result likhne ke liye `send-push-notification` edge function me optional `delivery_id` (ya `campaign_id`+`user_id`) accept karke wo row `delivered`/`failed` + FCM error text se update hogi (service-role client se, RLS aage bhi staff-read-only).
- Device token na hone par seedha `failed` + `'No registered app device'`.
- Naya read-only RPC `staff_campaign_audience_preview(_audience text)` → `{total, reachable, unreachable}`, send confirm box ke liye. Audience dropdown ke liye distinct `addresses.city` list.
- Sab writes pehle jaise `offers_require_writer()` ke through, `offers_audit` me before/after; koi naya table nahi.
- Files: `src/lib/offers.functions.ts` (preview + delivery types), `src/components/offers-page.tsx` (campaign modal, deliveries modal, audience dropdown, confirm box), `supabase/functions/send-push-notification/index.ts`, ek migration.
- Ant me `tsgo` typecheck.
