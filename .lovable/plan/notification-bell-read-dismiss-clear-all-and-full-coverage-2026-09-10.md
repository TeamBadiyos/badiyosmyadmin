# Notification bell: read, dismiss, clear all, and full coverage

Today the bell simply recomputes a live list of four things (open tickets, bookings with no expert, emergency alerts, pending extensions). Nothing can be marked read or removed, and clicking an item only switches the screen — it does not open the exact booking or ticket. Many other events never appear at all.

## What you will get

1. **Read / unread**
   - Unread items show a dot and bold title; the red badge counts unread only.
   - Opening the bell marks nothing automatically; clicking an item marks it read.
   - "Mark all as read" button in the panel header.

2. **Dismiss and clear**
   - Each row gets an X to remove it from your list.
   - "Clear all" removes everything currently listed.
   - Read/dismissed state is per staff member, so one person clearing does not hide items from others.
   - A tab switch between "Unread", "All" and "Dismissed" so nothing is lost by accident.

3. **Click goes to the right place**
   - Booking-related items open the Bookings screen *and* the booking's detail window directly.
   - Ticket items open Support Tickets with that ticket opened.
   - Emergency items open Emergency Alerts focused on that alert.
   - Merchant, expert, payout, reward and lead items open their own screens.

4. **Everything shows up here**
   New alert types added to the bell:
   - New support ticket (customer / partner / merchant)
   - Emergency alert raised
   - Booking needs an expert / nobody accepted before expiry
   - Booking cancelled by customer, and refund failed
   - Extension awaiting approval
   - New merchant application awaiting approval
   - New expert application / skill request awaiting approval
   - New account-deletion request
   - New business, city and partner interest leads
   - Waitlist request raised
   - Payout batch awaiting payment
   Each type keeps its own icon and colour, and the header shows counts per type.

## How it works

- New table `staff_notifications` (per staff member: notification key, type, title, body, target screen, target id, created_at, read_at, dismissed_at) with staff-only access rules, plus `GRANT`s.
- A generator function fans out the existing live conditions into rows once each (deduped on a stable key, e.g. `ticket:<id>`), called by the same server function that loads the bell and by database triggers for the new event types (merchant application, deletion request, leads, waitlist, payout batch, expert/skill request) so items appear instantly through the existing realtime channel.
- RPCs: `staff_mark_notification_read`, `staff_mark_all_read`, `staff_dismiss_notification`, `staff_clear_notifications`.
- `src/lib/alerts.functions.ts`: `getStaffAlerts` reads the table (filtered by unread/all/dismissed) and returns the counts; four new server functions wrap the RPCs.
- `src/components/notification-bell.tsx`: tabs, unread styling, per-row dismiss, header actions, optimistic updates via React Query.
- `src/routes/_authenticated/dashboard.tsx`: extend the bell's target handling to cover the new screens and pass through `bookingId` / `ticketId` / `alertId` so the correct detail window opens (reusing the existing `gotoBookings` + `selectedBookingId` pattern, with equivalent focus props for Support Tickets and Emergency Alerts).

## Notes

- Existing behaviour that pushes phone notifications to customers, experts and merchants is untouched; this is only the staff bell inside Command Center.
- Staff still receive no phone push (no staff device registration exists). Say the word if you want that too — it is a separate piece of work.
