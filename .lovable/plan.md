# Bonus Preview — "CREATE TABLE is not allowed in a non-volatile function" fix

## Kya hua

Bonus Preview par "Run preview" dabate hi error aata hai:
`CREATE TABLE is not allowed in a non-volatile function`.

Wajah confirm ho gayi: preview wala database function `staff_reward_period_preview`
STABLE mark hai (database verified: `provolatile = 's'`), lekin andar ek temporary
scratch table banata hai har expert ke ghante/orders/active din jodne ke liye.
Postgres STABLE function me koi bhi table banane nahi deta — isliye pehle hi step par
hi ruk jata hai aur kuch bhi calculate nahi hota.

Ye sirf preview screen ka issue hai. Bonus actually credit karne wala weekly/monthly
job alag function hai aur wo theek chal raha hai.

## Fix

Preview function ko dobara banayenge — bilkul wahi calculation, wahi output columns,
wahi Super Admin check — sirf do farq:

- Function ko VOLATILE kiya jayega, taaki wo apni scratch table bana sake.
- Read-only rahega: koi reward credit nahi, koi wallet entry nahi, koi ledger row nahi,
  koi audit entry nahi. Sirf hisaab dikhata hai.

Iske baad Bonus Preview par Monthly/Weekly dono period chala kar confirm karenge ki
result aata hai, aur pehle bataye gaye do test cases dobara check karenge:
130 ghante monthly par sirf ₹1,000, aur 32 ghante wale hafte par sirf ₹300.

## Technical detail

- Migration: `CREATE OR REPLACE FUNCTION public.staff_reward_period_preview(_period text, _period_start date)`
  — body unchanged, `STABLE` hata kar `VOLATILE`, `SECURITY DEFINER` + `SET search_path = public` waise hi,
  `is_super_admin_user()` gate waise hi, temp table `ON COMMIT DROP` waise hi.
- Grants dobara: EXECUTE to `authenticated`, `service_role`; REVOKE from `PUBLIC`, `anon`.
- Koi naya table nahi, koi schema change nahi, koi data change nahi.
- Frontend (`src/components/bonus-preview-tab.tsx`, `src/lib/rewards.functions.ts`) me koi badlav nahi.
