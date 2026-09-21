# Campaigns tab + "notification aa hi nahi raha" — jaanch aur plan

## 1. Aapke pehle sawaal ka jawab (ye tab hai kis liye)

Ye tab customers ke **mobile app par notification** bhejne ke liye hai — offer/coupon announce karna, sabko ya ek shehar ko.

Aapka campaign "Get 1st Booking Free": audience **Latur**, 21/9 ko 08:45 par bheja gaya, **7 customers** chune gaye (wahi naam modal me dikh rahe hain). Zariya sirf app notification hai — WhatsApp/SMS nahi.

Har naam ke aage jo **SENT** hai uska matlab abhi sirf itna: "is customer ka device registered tha aur bhejne ka request nikal gaya". Ye confirm nahi karta ki phone par dikha.

## 2. Notification kyun nahi dikh raha — jo abhi jaancha

Database me jaanch karne par:

- Push bhejne wala secret set hai, aur **Google (FCM) ne aaj subah tak notifications accept kiye hain** — 32 customer aur 13 expert devices ka "last used" aaj 09:18–09:20 ka hai, jo tabhi update hota hai jab Google se success aata hai.
- Yaani **server se notification ja raha hai aur Google accept kar raha hai.** Rukawat aage hai: ya to phone par app ki notification permission band hai, ya app me notification channel/handling set nahi hai, ya device par purana token bacha hai jo ab kisi active app install se juda nahi (Google phir bhi "accept" kar leta hai).
- Ek aur ishara: 15 customers ke paas 32 tokens hain — matlab purane install ke tokens bhi pade hain, unpar bheja gaya "success" ginta hai par kisi phone par dikhta nahi.

Iska pakka jawab ek **test notification** se milega, aur uske liye Command Center me abhi koi button hai hi nahi — isliye ye plan me shamil hai.

## 3. Kya banayenge

**A. "Send test notification" (Users screen par)**

Kisi bhi customer/expert ko chunkar ek test notification bhejna, aur turant screen par asli natija dikhana: kitne devices, har device par Google ka jawab (accepted / invalid token / permission-related error), aur error ka text. Isse 2 minute me pata chal jayega ki galti server ki hai ya app ki.

**B. Purane device tokens ki safai**

Jo token Google "invalid/unregistered" bole, wo apne aap hat jaye; saath me ek "last used" column dikhe. Isse "7 sent" jaisi jhooti ginti khatam hogi.

**C. Campaign ka sach wala status**

Teen status: **Queued** → **Delivered** (Google ne accept kiya) → **Failed** (kaaran ke saath: app install nahi, purana token, Google ne reject kiya). Push bhejne wala hissa ab har customer ka asli result campaign ki delivery row me wapas likhega. Purani 7 `sent` rows migration me `delivered` ho jayengi.

**D. Modal aur bhejne se pehle preview**

Modal me upar: audience, zariya (App notification), time, Delivered/Failed ginti; list me har naam ke aage kaaran; failed logon ki CSV. "Send now" se pehle confirm: "X customers chune gaye, Y ke paas app registered hai — sirf unhe jayega."

**E. Audience free-text nahi**

Audience ab dropdown: All customers ya database ke shehar ki list.

## 4. Jo Command Center se theek nahi ho sakta

Agar test notification me Google "accepted" bole aur phir bhi phone par kuch na dikhe, to fix **mobile app me** karna hoga — notification permission (Android 13+), notification channel, aur app band hone par notification dikhane wala handler. Wo alag app project hai; test ka result aate hi main saaf-saaf bata dunga ki kya badalna hai.

## 5. Technical

- Naya server fn + RPC/edge call: `sendTestPush({ user_type, user_id })` → `send-push-notification` ko `debug: true` ke saath call, function per-token `{ ok, status, error, invalid }` array return kare (abhi sirf counts deta hai). Super admin only, audit_logs me entry.
- `send-push-notification`: invalid tokens ko `device_tokens` se delete kare (abhi sirf mark/ignore), aur optional `campaign_delivery_id` mile to us row ko `delivered`/`failed` + error text se update kare (service-role client).
- `campaign_deliveries.status`: `queued|delivered|failed`; migration me purani `sent` → `delivered`.
- `staff_send_campaign`: pehle `queued` rows, phir push, result callback se update; token na ho to `failed` + 'No registered app device'.
- Naya read-only RPC `staff_campaign_audience_preview(_audience text)` → `{total, reachable, unreachable}`; shehar list `addresses.city` distinct se.
- Writes pehle jaise `offers_require_writer()` + `offers_audit` (before/after). Koi naya table nahi.
- Files: `src/lib/offers.functions.ts`, `src/components/offers-page.tsx`, `src/lib/users.functions.ts` + `src/components/users-page.tsx` (test button), `supabase/functions/send-push-notification/index.ts`, ek migration. Ant me `tsgo`.
