# TDS ko simple karna — ek hi screen, ek rate

Abhi TDS ke 16 alag-alag settings hain (har kamai ke liye alag rate, alag on/off, effective date, threshold, no-PAN rate, rounding rule) aur report ek alag tab me hai. Isko simplify karke ek hi screen par laaya jayega.

## Naya behaviour

**Ek "TDS" screen** (Wallet & Payout ke andar), jispe sirf:

- **TDS on/off** — ek hi toggle. Off = kisi bhi payout par TDS nahi katega.
- **TDS rate** — ek editable box, default 2%. Expert aur Area Partner, dono par yahi rate.
- **Report** — usi screen par neeche: financial year (April–March) chuniye, har person ka gross, kitna TDS kata, kitna deposit hua, CSV export aur "Mark deposited" (sirf Super Admin).

Sab kuch ek page par — alag TDS Report tab nahi rahega.

## Jo hataya jayega

Ye settings screen se bhi hatengi aur calculation se bhi:

- Expert ke liye alag toggle, Area Partner ke liye alag toggle (ab ek master toggle hi kaafi)
- Tips aur manual adjustment ke alag toggles
- Service / incentive / referral / courier / manual ke alag-alag rates
- No-PAN ka alag rate (PAN na ho tab bhi wahi ek rate lagega)
- Effective-from date, annual threshold, rounding rule ka option (rounding hamesha nearest rupee)

Commission & Incentives tab me jo "Finance switches & TDS settings" card hai, usme se saare TDS wale field hat jayenge — wahan sirf commission engine ke switches rahenge.

## Purana data safe rahega

Jo payouts pehle ho chuke hain unke gross, TDS aur net waise ke waise rahenge — sirf aage ke calculation par asar hoga. Koi purana record delete nahi hoga.

## Technical notes

- `compute_tds()` ko simplify karna: sirf `tds_master_enabled` (on/off) + `tds_default_rate` (%) padhega. Owner-type gate, effective-date, threshold, no-PAN branch aur per-earning rate lookups hata denge; rounding hamesha `round(gross * rate / 100)` rahega. Function SECURITY DEFINER + fixed `search_path` hi rahega.
- `ops_settings` se ye keys delete: `tds_expert_enabled`, `tds_partner_enabled`, `tds_tip_enabled`, `tds_manual_adj_enabled`, `tds_no_pan_rate`, `tds_effective_from`, `tds_annual_threshold`, `tds_rounding_rule`, `tds_rate_service`, `tds_rate_incentive`, `tds_rate_referral`, `tds_rate_courier`, `tds_rate_tip`, `tds_rate_manual_adj`. Bachenge sirf `tds_master_enabled` ('0') aur `tds_default_rate` ('2.0').
- `listFinanceSettings` (src/lib/commission.functions.ts) ka key filter `key.like.tds_%` hata kar sirf commission-engine keys par: `use_new_commission_engine`, `payout_batch_wallet_mode`, `commission_min_hq_share`, `reward_punctuality_gate_enabled`.
- Naya `getTdsSettings` / `setTdsSetting` server fn (super_admin write, ops_manager read-only) `src/lib/wallets.functions.ts` me, `staff_set_ops_setting` ke through taaki audit_logs me before/after jaye.
- `src/components/wallets-page.tsx` ka `TdsReportTab` rename → `TdsTab`: upar settings card (toggle + rate input, read-only jab super_admin na ho), neeche wahi existing report table, FY selector, CSV export, Mark deposited. Tab label "TDS Report" → "TDS".
- `src/components/commission-tab.tsx` ke `FinanceSettingsCard` ka heading "Finance switches" ho jayega; TDS fields apne aap gayab kyunki server ab wo keys return nahi karega.
- Payout items ke `tds_rate` / `tds_amount` / `net_amount` / `pan_last4` columns waise hi rahenge (historical snapshot), koi drop nahi.

## Build order

1. Migration: `compute_tds()` simplify + purani TDS keys delete.
2. Server functions: TDS settings read/write, `listFinanceSettings` filter update.
3. UI: wallets page par single TDS screen, commission tab se TDS fields hatna.
