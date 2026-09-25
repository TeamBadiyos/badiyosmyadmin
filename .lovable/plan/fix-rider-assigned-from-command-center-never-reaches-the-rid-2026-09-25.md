# Fix: rider assigned from Command Center never reaches the rider

## What is going wrong (confirmed on live data)
Order **E6AFE84D** was assigned to a rider from Command Center at 09:53. It is still stuck on "Searching". Two things break when staff assign a rider to a courier order:

- **The order is never marked as assigned.**
  - The rider's name is saved, but the order stays "Searching".
  - The Expert App only shows jobs that are assigned, so the job never appears for the rider.
  - Offers already sent to other riders stay open. The search also keeps running and can time out and send the order to refund.
- **Nobody is told.**
  - The new rider gets no alert.
  - A rider who is being replaced is not told either.
  - The customer doesn't get "Rider assigned".
- **No checks before assigning.** The screen lets staff pick a rider who is:
  - already on another courier job, or
  - offline or inactive, or
  - without the courier skill.

Clean bookings behave correctly. Assigning an expert there moves the booking to "Expert assigned" and alerts the expert. Reassigning an expert alerts both the old and the new expert. No change is needed for bookings.

## Fix
Rewrite the staff "assign/reassign rider" action so it does exactly what a rider's own Accept does, plus the staff extras.

**When the order is still searching:**
- Mark it "Rider assigned".
- Close every open offer for it.
- Mark the rider busy.

**When the order already has a rider** (before pickup):
- Replace that rider, keep the status, and free the old rider.
- Block the change after pickup, with a clear message.

**Checks before assigning.** The new rider must be:
- active,
- approved for the courier skill,
- not already on an active courier job or booking.

**Alerts:**
- The new rider gets "New courier job assigned", which opens the job.
- A replaced rider gets "Job reassigned".
- The customer gets "Rider assigned".
- The event is written to the order history as done by staff, and the audit log gets before/after as today.

**Screen:**
- The rider picker lists only eligible riders, showing distance and whether each is online.
- After you assign, the order refreshes and shows the new status.

**Stuck order:** order E6AFE84D will be fixed properly by running the new action on it again. It isn't patched by hand.

## Technical details
- Migration: replace `staff_courier_reassign_rider(_order_id, _expert_id)`, keeping the same name, signature and `courier_is_ops_staff()` check.
  - Lock the order.
  - Allowed only when status is SEARCHING, DRIVER_ASSIGNED or ARRIVED_PICKUP.
  - From SEARCHING it moves to DRIVER_ASSIGNED, which the status guard allows. From the other two the status stays the same.
  - Set `app.courier_actor_type='staff'` and `app.courier_actor_id=auth.uid()`, so the existing update-log trigger records the event.
  - Set `courier_offers.status='cancelled'` for pending offers on the order.
  - Update `is_busy` for the old and new rider.
  - Use `notify_expert_push` for the rider alerts (deep link `courier/<order_id>`) and `notify_customer_user_push` for the customer.
  - Each alert is wrapped so a push failure can't roll back the assignment.
  - The eligibility check matches `courier_offer_respond`'s "already on a job" rule, plus an approved courier skill from `partner_skills` (the same source as `courier_eligible_riders`).
- `listCourierRiders` in `src/lib/courier.functions.ts` is filtered to eligible riders. `OrderDetail` refreshes after assigning.
- No changes to bookings functions or to any other screen.
