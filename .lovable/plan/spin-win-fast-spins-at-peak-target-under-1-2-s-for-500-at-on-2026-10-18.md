# Spin & Win — fast spins at peak (target under 1–2 s for 500 at once)

## Goal
Stop spins from waiting in line on the same prize. Every guarantee stays the same: no overselling, one prize per customer/phone/device, and a retried spin returns the same result.

## What changes
1. **Prize tokens.** Each limited prize gets one ready-made "token" for every unit in stock (stock 50 = 50 tokens). A spin picks a prize by weight, then takes one free token with FOR UPDATE SKIP LOCKED. Spins skip tokens another spin is holding, so they don't wait.
2. **Fallback prize.** A fallback prize with no stock limit needs no token and no lock. If a limited prize has no free token left, the spin moves to the next prize, and ends at the fallback.
3. **No shared counters during the spin.** The "won" count on the prize row is no longer updated during each spin. Counts come from tokens and draws, so spins don't fight over one row.
4. **Stock edits in CC.** Raising stock adds tokens. Lowering stock removes only unused tokens, and stock can't go below the number already won. Existing events get tokens backfilled from their remaining stock.
5. **Guarantees kept.**
   - Each token can be used once, and each draw holds one token.
   - The existing per-account/phone/device limits and request-id idempotency stay as they are.
   - Wallet, coupon and physical-prize handling stay the same.

## Load test (approved)
- Create a TEST event with limited prizes plus a fallback, and 500 test customers/devices.
- Fire 500 spins at once. Report median, p95 and maximum time per spin, errors, final stock (never below 0), duplicate checks and retry results.
- Compare against the last run (median 7.3 s, maximum 12.7 s).
- Delete all test customers, phone records, devices, the event, its prizes, tokens and draws. Confirm nothing is left.

## Technical details
- New table `spin_prize_tokens(id, prize_id, event_id, draw_id null, claimed_at)` with a partial index on free tokens. GRANT to service_role only, RLS on, and the cc_reader SELECT policy.
- `app_spin`: per-identity advisory lock (hashed user/phone/device) instead of a lock on the prize row. Weighted pick runs over prizes that still have free tokens. Claim with `UPDATE ... WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`.
- Trigger on `spin_prizes` keeps the token count in step with stock edits.
- Stats/Redemptions read counts from tokens/draws.
- The test runs with the same concurrent harness as before (direct RPC calls through a DB pool) to stay clear of the login rate limit seen last time.
