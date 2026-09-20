# Bonus logic confirm + Bonus Preview (dry-run)

## 1. Logic confirm — haan, jaisa aap chahte hain waisa hi chal raha hai

Maine live rules aur evaluation code dono check kiye:

- Monthly hours ke chaaron slab (100h ₹500, 125h ₹1,000, 150h ₹1,500, 200h ₹2,000) ek hi group `monthly_hours` me hain.
- Weekly ke chaaron slab (25h ₹200, 30h ₹300, 35h ₹500, 50h ₹1,000) ek hi group `weekly_hours` me hain.
- Evaluation har group ke andar sabse bade amount se shuru karta hai, aur jis expert ko us group me ek baar bonus mil gaya usko usi group ka doosra slab nahi milta. Yani ek category me sirf sabse ooncha achieved slab.
- Active Bonus (₹1,000) aur Expert referral bonus (₹1,000) kisi group me nahi hain — ye alag category hain aur weekly/monthly ke saath judte hain.

To point 1 sahi hai, aur point 2 (har category ek tier group me) already lagu hai — koi data badalne ki zaroorat nahi.

## 2. Bonus Preview (naya)

Ek preview banega jo sirf hisaab dikhayega, paisa credit nahi karega.

Screen: Wallet & Payout → Commission & Incentives ke andar teesra sub-tab **Bonus Preview** (sirf Super Admin ko dikhega; Ops Manager ko nahi).

Upar controls: period type (Weekly / Monthly) aur period start date (default: pichla poora hafta / pichla mahina). "Run preview" dabate hi neeche table:

| Expert | Ghante | Active din | Orders | Category | Slab | Amount | Status / Kaaron |

- Jise milega: category (Weekly hours / Monthly hours / Active bonus), achieved slab aur amount.
- Jise nahi milega: saaf kaaran — "target se kam (32h < 35h)", "rating 4 se kam", "expert-fault complaint", "late start", "is period ka bonus pehle hi credited", "budget cap khatam".
- Upar summary: kitne experts ko milega, total kitna paisa banega.
- CSV export.

Ek bhi ledger entry ya wallet change nahi hoga.

## 3. Incentive screen category-wise

Incentives list ab flat nahi, category (tier group) ke hisaab se headings me dikhegi:

- **Monthly hours — sirf sabse ooncha slab milega** (4 rows, chhote se bade)
- **Weekly hours — sirf sabse ooncha slab milega** (4 rows)
- **Standalone (doosre bonus ke saath milta hai)** — Active Bonus, referral, baaki

Har group heading ke saath ek line explanation, aur slab rows threshold ke order me. Wahi grouping Growth → Rewards par bhi lagegi.

## 4. Test (approve ke baad chalega)

Preview par do test case chalake result bataunga:

- T1: 130 ghante wala expert → monthly me sirf ₹1,000 (125h slab). 100h wala ₹500 skip hona chahiye, 150h/200h qualify hi nahi.
- T2: 32 ghante wala hafta → sirf ₹300 (30h slab), ₹200 skip.

Dono cases synthetic (temp) data par preview ke through verify honge, live paisa touch kiye bina, aur data check ke baad hata diya jayega.

## Technical

- Nayi SQL function `staff_reward_period_preview(_period text, _period_start date)` — SECURITY DEFINER, `search_path = public`, sirf super_admin (role check `resolve_caller_identity`/staff_users, `is_active_staff` nahi). Ye `run_reward_period_jobs` ki hi metric + gate logic (`reward_gates_pass`, tier-group highest-only, budget cap, duplicate `trigger_event_ref` check) dohrayegi par `reward_apply_credit` call nahi karegi — sirf rows return. Koi naya table nahi.
- EXECUTE `authenticated` + `service_role`, revoke `PUBLIC`/`anon`.
- `src/lib/rewards.functions.ts`: naya `previewRewardPeriod` server fn (requireSupabaseAuth) + `RewardPreviewRow` type.
- `src/components/bonus-preview-tab.tsx` (naya) + `commission-tab.tsx` me teesra sub-tab, super_admin gate `getCommissionAccess().canWrite`.
- `src/components/incentives-tab.tsx` aur `rewards-page.tsx`: rows ko `condition.tier_group` se group karke headings ke saath render.
- Preview read-only hai isliye audit_logs entry nahi; baaki writes pehle jaise audited RPC se.
- Ant me `tsgo` typecheck.
