# Rewards system audit — what works, what is broken

## What I checked

Live database: reward programs, trigger types, the reward history table, referral records, the daily scheduled job, and every place in the backend that awards a reward. Plus the Rewards screen itself.

## Working correctly

- Rewards are awarded automatically when a booking is completed (both for the customer and for the partner), and when a customer leaves a rating.
- Referral reward on a friend's first completed booking is wired up and switched on (50 coins, active).
- Duplicate protection works: the same person cannot be paid twice for the same event.
- Reversing a reward correctly takes the money back out of the customer's coins or the partner/merchant wallet, and it is recorded in the audit trail.
- Archive / restore / permanent delete all work, and history keeps the program name after deletion.
- Customer rewards land in coins + wallet history; partner and merchant cash rewards land in their wallet.

## Confirmed problems

1. **Some reward types silently pay nothing.** The form offers "coins", "cash", "free booking" and "percentage off". For partners and merchants only "cash" actually credits anything — "coins" for a partner or merchant writes a history entry but no money. "Free booking" and "percentage off" credit nothing for anyone and no app redeems them.

2. **"Weekly" and "monthly" recurrence do nothing.** They are selectable but behave exactly like "per event" — a customer could earn the same weekly reward many times in one week.

3. **Archived time-based rewards still pay out.** The nightly job that handles "count threshold" and "hours threshold" rewards ignores the archived flag, so an archived program can still hand out money.

4. **Merchants can only ever earn from the periodic count reward.** Nothing awards a merchant when an order completes, so most merchant reward setups will never fire.

5. **The partner "reward earned" alert never fires.** It listens for the wrong actor label, so partners get only the generic push and not the in-app alert.

6. **Two referrals are stuck and will never pay.** Both were linked today to the same referrer. One of them belongs to a customer who already has 5 completed bookings, and the rule requires the referred person's *very first* completed booking overall — so it can never trigger. The other is fine and will pay on that customer's first completed booking.

7. **Referral config has unused settings.** "Milestone referrals: 5 / milestone reward: 100 coins" is stored but nothing in the system reads it, so it silently does nothing.

## Proposed fixes

- **Reward types:** make "coins" credit partners and merchants properly (same wallet path as cash). Remove "free booking" and "percentage off" from the form until an app can redeem them, so nobody creates a reward that pays nothing.
- **Recurrence:** enforce "weekly" and "monthly" — one credit per person per calendar week/month per program.
- **Archived programs:** exclude archived programs from the nightly periodic job.
- **Merchants:** award rewards when a merchant order is completed, and add a merchant "order completed" trigger type so merchant programs can actually be built.
- **Partner alerts:** fix the actor label so the in-app "Reward earned" alert reaches partners; also send the reward alert to merchants.
- **Referral rule:** change from "first completed booking ever" to "first booking completed after the referral code was applied". This unsticks the existing case and matches how people actually use invite codes. Existing stuck rows then resolve on their next completed booking.
- **Milestone settings:** either wire the milestone bonus (extra coins at N successful referrals) or remove the fields from the Referrals screen. I will wire it, since it is already displayed as a setting.

## Verification after the fixes

- Create one throwaway program of each type/recurrence and confirm the credit lands (or is correctly blocked the second time within the same week).
- Complete a test booking for the referred customer and confirm the referrer receives coins, a wallet entry and a notification.
- Complete a merchant order and confirm the merchant reward path fires.
- Archive a periodic program, run the nightly job manually, confirm nothing is paid.

## Technical notes

- `reward_apply_credit`: add coins handling for `partner`/`merchant`, add merchant push, add per-week/per-month uniqueness check before insert.
- `run_reward_period_jobs`: add `archived_at IS NULL`.
- `credit_referral_for_booking`: replace `completed_count <> 1` with "first booking completed after `referral_transactions.created_at`"; add milestone bonus using `referral_config.milestone_referrals`/`milestone_reward_coins`.
- New trigger key `order_completed` in `reward_trigger_types` (merchant), called from `merchant_advance_order`/`merchant_orders_ledger_on_complete`.
- `notify_expert_reward_credited`: match `actor_type = 'partner'`.
- `REWARD_TYPES` in `src/components/rewards-page.tsx` trimmed to coins/cash.
