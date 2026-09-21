# Notification error — asli wajah mil gayi

## Kya ho raha hai

Screenshot me "Devices 0, Accepted 0, Failed 14" dikha — ye ulta-pulta isliye lag raha hai kyunki us customer ke paas asal me **14 registered devices hain**, lekin notification Google tak gaya hi nahi.

Server logs se saaf wajah:

```text
[push] FCM auth failed: FCM token exchange failed: 400
{"error":"invalid_grant","error_description":"Invalid grant: account not found"}
```

Matlab: jis Firebase service account se hum notifications bhejte hain, **wo account ab Google ke paas maujood nahi hai** (delete ho gaya, ya uski key hata di gayi, ya Firebase project hi badal gaya).

Isliye **kisi ko bhi koi notification nahi ja raha** — na customer ko, na expert ko, na campaign se. Puraana campaign "delivered" isliye dikha tha kyunki tab hum sirf request bhejna gin rahe the.

## Ye kaise theek hoga

### 1. Nayi Firebase service account key (ye aapko karna hoga)

Firebase Console → Project Settings → Service accounts → "Generate new private key". Us file me se teen cheezein chahiye: project id, client email, private key. Ye teeno secret ke roop me update karni hongi — chat me paste mat kijiyega, main secure form khol dunga.

Agar aap chahein to iske badle Firebase Cloud Messaging ka ready-made connection bhi laga sakte hain (ek hi baar sign-in, key manually sambhalni nahi padegi). Aap jo chunenge, wahi karenge.

### 2. Galat ginti wali screen theek karna

Abhi jab Google ki authentication fail hoti hai, screen "Devices 0" dikhati hai jabki devices 14 hain, aur asli error message kahin nahi dikhta. Isko theek karenge:

- Devices ki sahi ginti dikhegi.
- Fail hone par saaf laal message: "Push service ki Google key invalid hai — nayi Firebase key lagani hogi", ya jo bhi asli kaaran ho.
- Campaign ki delivery rows me bhi yahi kaaran likha jayega, "failed" ke saath.

### 3. Key lagne ke baad verify

Nayi key lagate hi aapke apne number par test notification bhejenge. Agar "Accepted" aur phone par notification dono aa gaye — sab theek. Agar "Accepted" aaye par phone par na dikhe, to baaki kaam mobile app me hoga (permission/channel), Command Center me nahi.

## Technical

- `supabase/functions/send-push-notification/index.ts`: auth-failure branch abhi `{ sent: 0, failed: tokens.length, error }` return karta hai bina `tokens` aur `results` ke — isme `tokens: tokens.length`, `results` (debug mode) aur ek human-readable `reason` add karenge; `markDelivery('failed', ...)` me generic "Push service auth failed" ki jagah Google ka asli error text (truncated) jayega.
- `src/lib/users.functions.ts` (`sendTestPush`) aur `src/components/users-page.tsx` (`TestPushModal`): response ka `error`/`reason` field surface karenge; counts mapping theek karenge.
- Secrets: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` — naye service account se update (secure form), ya Firebase Cloud Messaging connector se connect karke gateway route par shift.
- Koi DB schema change nahi.
