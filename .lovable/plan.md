# Wallet: one source of truth

## 1. What exists today
| | Old "coins" wallet | New closed-loop wallet |
|---|---|---|
| Balance | `users.total_coins_earned` | `customer_wallets` (cash_balance, bonus_balance) |
| History | `wallet_transactions` (+ `coin_redemptions` for bookings paid in coins) | `customer_wallet_ledger` (with cash_after / bonus_after) |
| Writers | credit_referral_signup, credit_referral_for_booking, reward_apply_credit, bookings_coin_debit, bookings_coin_refund_on_cancel, system_coins_reserve/release, staff_reverse_referral_reward, staff_reverse_reward, reward_ledger_after_reversal, my_coin_balance (read) | wallet_post, app_create_booking_wallet, customer_wallet_pay, customer_wallet_start_topup, staff_wallet_adjust, staff_wallet_refund_in, booking_refund_split, wallet_expire_bonuses, customer_wallet_get |
| Today | 28 customers, ₹2,972 total (1 coin = ₹1). Balance matches the history for every customer | 0 customers, ₹0. No top-ups yet |

Expert/merchant wallets (`wallet_ledger`, `experts.wallet_balance`) are separate and not touched.

Old balances (top): Janhavi Baheti 838 · Smita Bajaj 410 · Anjushri Chandak 400 · Gaurav Baheti 292 · P S 220 · Aditya Khandelwal 140 · Kiran Modani 100 · Manisha Malu 90 · plus 20 smaller. One customer has a small negative history balance. That customer gets moved at 0 and is listed in the report.

## 2. One-time move
- For each customer with old coins > 0, add one "Opening balance (old coins)" entry in the new wallet as **Bonus that expires in 30 days**. Each move is linked to the customer, so running it twice cannot double the money.
- Then set the old coin balance to 0 and record one closing "Moved to wallet" line in the old history. Total money is unchanged.
- The old tables become read-only, with a database guard that blocks new rows and edits. They stay visible as history.

## 3. Customer App functions
- `app_wallet_summary()` returns `{ balance, cash, bonus, bonus_expiring: [{ amount, expires_at }] }`. The app can then clearly show "₹X bonus expires on DD MMM".
- `app_wallet_history(_limit, _before)` is paged, newest first. It returns top-ups, payments, refunds, bonuses, referral credits and adjustments, with a plain label, amount, cash/bonus, date and expiry. Old coin history is included and marked "Old coins" so customers still see past entries.
- The existing `my_coin_balance` keeps working for old app builds but returns the new wallet total.

## 4. Every movement goes to the new wallet only
- Referral signup / first booking / milestone rewards and customer reward programmes become **Bonus, 30-day expiry**. Reversals take the amount back from the wallet.
- Booking paid with coins (free_ payments) is paid from the wallet. The rule that coins can't pay GST is dropped, so wallet money (cash or bonus) can pay the full amount including GST. Cash is used first, bonus last. Cancellation puts the money back the same way.
- Top-ups, booking payments, refunds and staff adjustments already use the new wallet. No change there.
- Bonus expiry runs through the existing expiry job.

## 5. Proof
After the move, I'll report before/after for 5 customers (Janhavi Baheti, Smita Bajaj, Anjushri Chandak, Gaurav Baheti, Kiran Modani): old coins before, new wallet after, and the difference (must be ₹0). I'll also check that totals match: ₹2,972 out of the old wallet and ₹2,972 into the new one.

## Notes
- The Customer App is a separate project. It must switch to `app_wallet_summary` / `app_wallet_history` and show the 30-day bonus expiry text.
- Moved balances start their 30-day clock on the day of the move.

## Technical details
- Migration: idempotent insert into `customer_wallet_ledger` via `wallet_post(uid,'opening_balance','bonus',amt,'legacy_coins',uid,…, now()+30d)`, guarded by NOT EXISTS on ref_type='legacy_coins'. Then zero `users.total_coins_earned` under `app.users_bypass` and add closing debit rows. BEFORE INSERT/UPDATE/DELETE triggers raise on `wallet_transactions` and `coin_redemptions` once the move is done.
- Rewrite the listed old writers to call `wallet_post` (type referral_bonus / reward_bonus / booking_payment / refund / reversal). bookings_coin_debit becomes a spend of total incl. GST, cash first then bonus. Reversals debit bonus first and allow partial if already spent (record the shortfall).
- New SECURITY DEFINER RPCs `app_wallet_summary`, `app_wallet_history`, granted to authenticated and scoped to auth.uid(). History is a union of the new ledger plus legacy rows tagged `legacy`.
- Snapshot of the 28 balances is taken in the same migration and saved to `audit_logs` for the before/after report.
