# Referral rewards fix + reward program archive/delete

## What I checked

- No referral has ever been recorded: 0 rows in referral history, and not one customer has a referrer attached (10 of 12 customers do have their own referral code).
- The referral crediting step only fires when a booking is in the old "confirmed" state. No booking sits in that state any more — since bookings now dispatch automatically on payment, they move straight past it. So the referral reward can never be paid out today. This is the real bug.
- Deleting a reward program is blocked by a rule that refuses deletion when any reward has already been paid out under it. There is currently no archive option, so such a program can only be paused.

## Referral fix

Rework the crediting step so it runs when the referred friend's **first booking is completed** (your choice), not on the outdated "confirmed" state:

- Trigger it from the existing booking-completion path so it no longer depends on the customer's app calling it at the right moment.
- Count the friend's first completed booking properly, including current booking states.
- Guard against double payouts: one referral credit per referred customer, ever.
- Skip credit if the booking is later cancelled/refunded before completion (it simply never fires).
- Keep the existing effects: referral marked rewarded, coins added to the referrer, wallet entry created, push notification sent, and any matching reward program evaluated.
- Also give the 2 customers who are missing a referral code one, so their invite screen works.

Then I'll run an end-to-end test: link a test customer to a referrer's code, complete a booking, and confirm the referral shows as rewarded, coins land in the wallet, and the notification is sent.

## Reward program archive + delete

- Add an archived state to reward programs. Archiving hides a program from the active list and stops it from ever triggering again, while all past payouts stay intact.
- The Rewards screen gets an "Archived" filter so archived programs can be viewed and restored.
- Delete now behaves as: programs with no history delete outright; programs with history offer "Archive" as the default action and "Delete permanently" behind a typed confirmation. Permanent delete keeps the history rows, which keep showing the program's saved name.

## Technical notes

- `credit_referral_for_booking` is rewritten and invoked from the booking-completion flow; the current `status = 'confirmed'` gate and single-booking-count check are replaced with a "first completed booking + no prior credited referral" check, still under a `pending` referral row.
- Reward ledger already stores enough to render history after program deletion; a `program_name` snapshot column is added to `reward_ledger` (backfilled) so permanently deleted programs still display correctly, and the ledger's program foreign key becomes `ON DELETE SET NULL`.
- `reward_programs` gains `archived_at`; `evaluate_reward_triggers` and `staff_*` listing/upsert filter it out. New `staff_archive_reward_program` / restore RPC; `staff_delete_reward_program` gains a `_force` flag (super admin, audited).
- UI changes in `src/components/rewards-page.tsx` and `src/lib/rewards.functions.ts`.
