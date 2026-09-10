# Full app health check — findings and fix plan

I checked the live database, background jobs, notification paths and recent error logs. Three real problems are running right now, plus several notification steps that are silently missing.

## Confirmed problems

### 1. Job broadcast never widens its search (breaking, happening now)
The background job that widens the search radius when nobody accepts a booking has been failing every run: the safety rule "booking changes must go through server-side functions" is blocking the job's own update. Result: a booking only ever goes out to experts in the first small radius, then expires and cancels. 83 failures recorded.

Fix: allow this internal job to update the search radius (same trusted path the other system jobs use), then confirm the job runs clean and a test booking's radius grows.

### 2. Automatic refunds still cannot run
The saved payment-gateway credentials are test-mode and are rejected by the gateway. Expired bookings get cancelled with no money returned. Nothing in the app can fix this — the live credentials must be saved. I'll re-test the moment they are.

### 3. Tips, rewards and referral coins reach wallets but nobody is told
Money is credited correctly, but no message is sent. Covered below.

## Notification coverage — what exists vs what's missing

Working today: booking confirmed, expert assigned, service started, service completed, booking cancelled, new job broadcast to experts, manual assignment to an expert, extension requested and decided, completion reminder, support ticket resolved, new order to a merchant.

Missing — to be added:

| Moment | Who should be told |
| --- | --- |
| Customer tips the expert | Expert ("You received a tip") |
| Reward coins/cash credited | Customer, expert or merchant |
| Referral bonus credited | Referrer |
| Payout marked paid | Expert / merchant |
| Merchant order accepted, ready, out for delivery, completed, rejected | Customer |
| Expert declines a job | Customer only if nobody is left (currently silent until expiry) |
| New support ticket arrives | Staff (today it only appears in the bell if someone is looking) |
| Emergency alert raised | Staff |
| Expert forced offline / account approved or rejected | Expert |

Each new message will reuse the existing push path, so custom alert sounds and in-app routing keep working.

## Also worth fixing

- Partner welcome email with login details is still not possible: no email provider is connected. Say the word and I'll set one up.
- Staff currently receive no phone notifications at all — only the in-app bell. If staff should get pushes, that needs staff device registration; tell me if you want it.

## Technical notes

- Radius job: `expand_stale_broadcasts()` is blocked by the `bookings_before_update()` guard; it needs the system bypass flag the other system RPCs set.
- New notifications route through `notify_push_event` / `notify_customer_alert` / `notify_expert_alert`, added inside `record_booking_tip`, `reward_apply_credit`, `credit_referral_for_booking`, `staff_mark_payout_item_paid`, `staff_mark_payout_batch_paid` and `merchant_advance_order`, plus a new merchant/customer status message map.
- Each new alert type gets a row-compatible `alert_type` so Notification Sounds can attach audio.
- After the migration I'll re-run the cron history and push response logs to confirm success, and check the notification bell still loads.
