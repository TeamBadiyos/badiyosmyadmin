# Incentive plans editable screen + purana pricing hatana

## 1. Incentive plans — Wallet & Payout ke andar hi poora editor

Abhi incentive programs sirf **Growth → Rewards** me hain, aur "Commission & Incentives" tab me sirf commission dikhta hai. Isliye lagta hai ki incentive ka option hai hi nahi.

Naya: "Commission & Incentives" tab do hisson me bat jayega —

- **Commission** (jaisa abhi hai: default rule, product-wise rules, bulk edit, simulator, parity check).
- **Incentives** (naya, usi tab me): Expert/Partner ke saare bonus programs ki list — naam, kis cheez par milega, kitna, kitni baar mila — aur har row par **Edit**, **On/Off**, **Archive**, **Delete**. Upar **+ New incentive** button.

Ye programs wahi hain jo Growth → Rewards me dikhte hain (ek hi jagah ka data), bas ab paise wali screen par bhi poori control ke saath.

### Program form me kya-kya editable hoga

Abhi form me sirf naam, trigger, amount, recurrence aur tareekh milti hai. Poster wale plans ke saare hisse add honge:

- **Ghante / active din / orders ka target** (pehle se hai)
- **Slab group** — jaise "weekly hours" ke 25/30/35/50 ek hi group me; ek hi group me sabse ooncha slab hi milega
- **Minimum average rating** (default 4)
- **Expert ki galti wali complaint na ho** — on/off
- **Time par pahunchna zaroori** — on/off
- **Monthly budget cap** (optional) — cap cross hone par payout rukega aur Super Admin approval ke liye log hoga
- Amount, reward type (cash/coins), period (weekly/monthly), valid from/until, active on/off

Har jagah short madad-text hoga taaki samajh aaye kaunsa field kya karta hai.

### Access

Sirf Super Admin edit/create/delete kar sakega; Ops Manager ko sirf dikhega (buttons disabled). Har change activity log me before/after ke saath jayega — abhi jaise hota hai.

## 2. Service Catalogue se purana pricing hatana

- Price rows me abhi bhi "E ₹80 · P ₹10 · HQ ₹59" dikhta hai — ye poori tarah hat jayega. Row par sirf naam, duration, customer price aur was-price rahega.
- Purane saved expert/partner/HQ values database se clear kar diye jayenge (columns khaali), taaki kahin se bhi ye purane numbers na padhe jaayein.
- Price form me jo chhupa hua pass-through tha wo bhi hat jayega — ab wahan sirf Customer price aur Was price.

Paisa ka hisaab poori tarah Wallet & Payout → Commission & Incentives se hi hoga.

## Technical notes

- `reward_programs` me koi naya column nahi — slab group, rating gate, complaint gate, on-time gate aur budget cap sab `condition` jsonb me hi rehte hain (`tier_group`, `min_avg_rating`, `no_complaints`, `require_on_time`, `monthly_budget`), jaise `run_reward_period_jobs` already padhta hai. Sirf UI expose karega; `staff_upsert_reward_program` waisa hi rahega.
- Naya `src/components/incentives-tab.tsx` (list + ProgramModal), jo `src/lib/rewards.functions.ts` ke existing fns use karega (`listRewardTriggerTypes`, `listRewardPrograms`, `upsertRewardProgram`, `setRewardProgramActive`, `archiveRewardProgram`, `deleteRewardProgram`, `getRewardProgramStats`).
- `commission-tab.tsx`: andar do sub-tabs "Commission" | "Incentives"; write gate `getCommissionAccess().canWrite` se.
- `rewards-page.tsx` ka ProgramModal bhi same extended fields dikhayega — duplicate form se bachne ke liye modal ko shared component me nikal kar dono jagah use karenge.
- Catalogue: `service-catalogue-page.tsx` ki price row se `expert_payout / partner_commission / hq_share` wala line hatana, `PriceOptionModal` se pass-through state + note hatana, aur `catalogue.functions.ts` ke upsert payload se teen fields nikalna.
- Data cleanup (run_sql, schema change nahi): `UPDATE service_price_options SET expert_payout = NULL, partner_commission = NULL, hq_share = NULL;` — columns drop nahi karenge kyunki purani parity/fallback queries unhe reference karti hain; sirf values khaali.

## Build order

1. Shared incentive program form + Incentives sub-tab in Commission & Incentives.
2. Rewards page ko shared form par shift karna.
3. Catalogue se pricing display/fields hatana + purane values clear karna.
