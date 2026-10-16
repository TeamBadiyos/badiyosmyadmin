# Wallet bonus expiry: settings, reminders, expiry entries

## 4. "Clothing & Footwear" — what still points to it
Only one record: **Canvas_couture1**, a store draft that was deleted on 6 Oct 2026. No live stores and no sponsored slots use it. Plan: move that deleted draft to "Other" and delete "Clothing & Footwear" (logged in the audit log).

## 1. Bonus stays bonus, expiry editable
- Migrated old coins stay **Bonus** (already done). Their expiry is 30 days from the move date (today, 17 Oct 2026, so they expire on 16 Nov 2026).
- New bonus expires N days after the date it is credited.
- New **Settings → Wallet** box: "Bonus expires after (days)", default 30, range 1 to 365, super admin only, with an audit log entry.
- A change applies only to bonus credited after the change. Bonus already in a wallet keeps its date, so customers aren't surprised.
- The Customer App summary returns the current number of days and the bonus note text uses it.

## 2. Expiry reminders (15, 10 and 5 days before)
- Runs once a day at **10:00 AM IST**.
- For each customer, it adds up all bonus that expires on the day 15, 10 or 5 days from today. Bonus already spent is not counted. If that adds up to ₹0, no message is sent.
- One message per customer per reminder day. A reminder log stops repeats, even if the job runs twice.
- Sent as push and as an in-app notification, in English and मराठी:
  - "₹{amount} badiyos Wallet bonus expires on {date}. Use it on your next booking 🎉"
  - "तुमचा ₹{amount} badiyos Wallet बोनस {date} ला संपेल. पुढच्या बुकिंगला वापरा 🎉"
  - The date is written like "16 Nov".
- Tapping it opens the **Clean tab**.
- **Opt-out:** there is no offer-notification opt-out setting for customers today. I'll add one ("Offer notifications", on by default) plus a function the Customer App can call to switch it on or off. Customers who switch it off are skipped. Until the app shows the switch, everyone gets reminders.

## 3. On expiry
- The daily expiry job already deducts expired bonus. Each deduction becomes one ledger entry labelled **"Bonus expired"**, showing the amount and the date it was credited.
- If part of the bonus was spent first, only what's left is deducted, never more than the bonus balance. Bonus is spent earliest-expiry first, so the ones expiring soonest go first.
- Wallet history in the Customer App and in CC (Finance → Wallet ledger) shows it as "Bonus expired" with a minus amount.

## Technical details
- `ops_settings.wallet_bonus_expiry_days` (default 30). Every 30-day expiry written in code (`wallet_transactions_redirect`, `wallet_return`, the referral/reward paths) reads it through `wallet_bonus_days()`. The Wallet settings UI goes in the existing wallets page.
- Remaining bonus per credit row: spending from bonus is allocated FIFO by `expires_at`, and the remaining amount per row is calculated in a helper `wallet_bonus_lots(uid)`. Reminders and expiry both use it, so they always agree.
- `users.offer_notifications boolean default true`; `app_set_offer_notifications(bool)` for the Customer App.
- `wallet_expiry_reminders(user_id, expires_on, days_before)` with a unique key, plus `wallet_send_expiry_reminders()`. That function calls `notify_push_event('customer', uid, 'wallet_bonus_expiry', title, body, {route:'clean', amount, expires_on, body_mr})` and writes an in-app row to `party_notifications`.
- A daily pg_cron job at 04:30 UTC runs only the SQL above. Once a day keeps database load low; the trade-off is that a reminder can arrive up to a day after midnight on its day.
- The existing `wallet_expire_bonuses` is updated to use the lots helper, with reason "Bonus expired" and ref_id set to the credit row.
