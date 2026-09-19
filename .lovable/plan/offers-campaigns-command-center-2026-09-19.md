# Offers & Campaigns (Command Center)

Sidebar me ek naya section "Offers & Campaigns" — teen tabs: Coupons, Referral Rewards, Campaigns. Sab kuch already maujood tables par banega; koi naya table nahi.

## 1. Coupons

- **List:** code, title, discount (flat ₹ / % / free minutes), used/limit, validity window, status badge, aur ek active/pause toggle. Search + status filter.
- **Create/Edit form:** code, title, discount type + value, max discount, min order, valid from/until, total usage limit, per-customer limit, audience (Sab customers / Sirf referral reward).
  - "Sirf referral reward" wale coupons customer app me publicly available nahi honge — sirf milestone reward ke through milte hain.
- **Coupon detail:** click karne par uski redemptions list — customer ka naam/number, booking, base amount, discount saved, date, status.
- **Delete nahi** — sirf pause/resume.

## 2. Referral Rewards (Milestones)

- Milestone list: naam, kitne qualified referrals chahiye, reward (free minutes / flat ₹ / %), max discount, min order, validity days, active toggle.
- Har milestone ke saath "kitne customers ne kamaya" count, aur click par earners ki list (customer, kab mila, kaunsa coupon issue hua).
- Ek customer ko ek milestone sirf ek baar — ye rule already database me hai, UI bas usko surface karega (dobara issue ki koshish block).

## 3. Campaigns

- **Create:** title, message, optional image URL, deep link, audience (All customers / ek city).
- **Send now:** us audience ke customers ko push jaata hai, har recipient ke liye delivery record banta hai, aur "Offers me bhi dikhe" toggle on ho to campaign customer app ke Offers tab me publish hota hai.
- **History:** sent date, recipients count, delivered/failed breakdown, per-customer delivery status list.
- Scheduling abhi nahi — sirf draft aur send now.

## Access rules

Aapke system me abhi sirf teen roles hain: Super Admin, Ops Manager, Area Partner. Aapke kehne ke mutabik Ops Manager ko City Manager ki tarah treat karenge:

- **Super Admin:** sab kuch — coupons, milestones, campaigns create/edit/pause.
- **Ops Manager (City Manager):** create/edit/pause kar sakta hai, lekin campaigns sirf apni assigned city ke liye bhej sakta hai (uske staff record ki zone-city se).
- **Area Partner:** in screens ka koi access nahi — sidebar me dikhega hi nahi aur direct URL bhi block.
- Finance aur Support Executive roles abhi exist nahi karte, isliye unke liye alag rule nahi banaya. Jab wo roles add honge, read-only Finance aur no-access Support easily jod denge.

Role check `is_active_staff` se nahi, balki staff record ke role se hoga — har write operation server par role verify karega.

Har create / edit / pause / send `audit_logs` me before-after ke saath record hoga.

## Dashboard

Dashboard par chaar naye numbers: **total coupons used**, **total discount diya**, **active campaigns**, **rewards issued** (milestone awards). Segment filter ke saath consistent rahega.

## Technical notes

- Tables reuse: `coupons`, `coupon_redemptions`, `customer_coupons`, `referral_milestone_programs`, `referral_milestone_awards`, `marketing_campaigns`, `campaign_deliveries`.
- Ek schema change: `campaign_deliveries` me `status` (`sent` / `delivered` / `failed`) + `error` text field — per-customer delivery status ke liye (aapne approve kiya). Koi naya table nahi.
- Role-scoped RPCs (SECURITY DEFINER, `super_admin` + `ops_manager` only, audit insert included): `staff_upsert_coupon`, `staff_set_coupon_active`, `staff_upsert_milestone_program`, `staff_set_milestone_active`, `staff_create_campaign`, `staff_send_campaign`. Ops Manager ke liye campaign audience city uske `staff_users.zone_id → zones.city` se validate hogi.
- `staff_send_campaign`: audience resolve (all → sab active customers; city → us city ke users, address/zone se), `campaign_deliveries` rows insert, existing push helper (`notify_customer_user_push` pattern) se push, `recipients_count` + `sent_at` + `status='sent'` set.
- Server functions: naya `src/lib/offers.functions.ts` (coupons, redemptions, milestones, campaigns) — `requireSupabaseAuth` + role guard, existing `src/lib/segments.functions.ts` wale pattern par.
- UI: `src/components/offers-page.tsx` teen tabs ke saath (+ chhote modal components), `src/routes/_authenticated/dashboard.tsx` ke `NAV_GROUPS` me "Offers & Campaigns" entry aur role-based visibility.
- Dashboard counters `src/lib/dashboard.functions.ts` ke `getDashboardStats` me add honge aur dashboard cards me render.
