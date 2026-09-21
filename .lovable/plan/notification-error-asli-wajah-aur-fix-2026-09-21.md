# Notification error — asli wajah aur fix

## Kya ho raha hai

Screenshot me "Devices 0, Accepted 0, Failed 14" dikha — ulta-pulta isliye lag raha hai kyunki us customer ke paas asal me **14 registered devices hain**, lekin notification Google tak gaya hi nahi.

Server log se saaf wajah:

```text
[push] FCM auth failed: FCM token exchange failed: 400
{"error":"invalid_grant","error_description":"Invalid grant: account not found"}
```

Matlab purani Firebase service account key ab valid nahi hai — isliye **kisi ko bhi koi notification nahi ja raha**, na customer ko, na expert ko, na campaign se.

## Fix

### 1. Nayi key use karna

Aapne nayi key Supabase me `FIREBASE_SERVICE_ACCOUNT_JSON` ke naam se daal di hai. Abhi push bhejne wala hissa purane teen alag-alag secrets (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`) padhta hai, isliye nayi key ka istemal hi nahi ho raha.

Usko aise badlenge: pehle `FIREBASE_SERVICE_ACCOUNT_JSON` padhega aur usi me se project id, client email aur private key nikal lega; agar wo na mile tabhi purane teen secrets par wapas jayega. Isse aage key badalni ho to sirf ek hi jagah badalni padegi.

### 2. Galat ginti aur chhupa hua error theek karna

Abhi Google ki authentication fail hone par screen "Devices 0" dikhati hai jabki devices 14 hain, aur asli kaaran kahin nahi dikhta. Theek karenge:

- Devices ki sahi ginti.
- Fail hone par saaf laal message asli kaaran ke saath (jaise "Firebase key invalid hai").
- Campaign ki delivery list me bhi wahi asli kaaran likha jayega.

### 3. Verify

Key wire hone ke baad aapke apne number par test notification bhejenge aur turant batayenge Google ne kya kaha. "Accepted" aaya par phone par na dikhe — to baaki kaam mobile app me hai (permission/channel), Command Center me nahi.

## Technical

- `supabase/functions/send-push-notification/index.ts`: naya helper `loadServiceAccount()` — `Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")` ko `JSON.parse` karke `project_id` / `client_email` / `private_key` lega (private key me `\n` unescape), warna existing `FCM_*` env vars fallback. `FCM_PROJECT_ID` ke saare use isi resolved value se honge.
- Same file: auth-failure branch abhi `{ sent: 0, failed: tokens.length, error }` return karta hai bina `tokens`/`results` ke — usme `tokens: tokens.length`, `reason` (human readable) aur debug `results` add honge; `markDelivery('failed', …)` me generic "Push service auth failed" ki jagah asli error text (truncated) jayega.
- `src/lib/users.functions.ts` (`sendTestPush`) + `src/components/users-page.tsx` (`TestPushModal`): response ka `error`/`reason` surface karenge aur counts mapping theek karenge.
- Koi DB schema change nahi, koi naya secret nahi.
