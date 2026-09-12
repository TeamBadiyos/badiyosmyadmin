# Waitlist auto-notify when an expert becomes available

## Answer first

No, there is no automatic follow-up today. Joining the waitlist only writes a row into the waitlist table. Nothing watches experts coming online or finishing jobs, and no message of any kind is sent afterwards — so the promise in the capacity message ("we will notify you as soon as an expert is free") is currently not kept.

Confirmed by checking the waitlist table (no "notified" tracking of any kind), every database routine that touches it (only the Command Center listing), and the triggers on the expert record (only the existing expert status alert).

## What to build

When an expert becomes available in an area where people are waiting, notify those customers once.

**Availability moments that count**
- Expert switches online.
- Expert finishes a job and is no longer busy.

**Who gets notified**
- Waiting entries in the same city, matching the expert's service segment, within the same distance the dispatch broadcast uses for that city (the configured starting radius), measured from the waiting customer's saved location.
- Each entry is notified at most once; after notifying, it is marked "notified" with a timestamp.
- Entries older than 7 days are skipped (stale) and entries already notified are never re-sent.
- A short cooldown per area (default 15 minutes) so several experts coming online at once do not produce a burst of duplicate messages.

**How they are notified**
- Push notification through the existing push infrastructure ("Good news — an expert is available near you. Tap to book.") opening the booking flow.
- A WhatsApp entry queued as a placeholder, drained by the same worker that already handles dispatch alerts — logs only until AiSensy goes live, identical to existing behaviour.

**Command Center**
- The Waitlist screen gains a "Notified" indicator per group plus a count of people still waiting versus already notified.
- A manual "Notify waiting customers" button per area so staff can trigger the same message on demand.

## Technical notes

- Migration adds to `waitlist_requests`: `notified_at timestamptz`, `notify_count int default 0`, and an index on `(status, city, created_at)`.
- New table `waitlist_notify_events` (`id`, `waitlist_id`, `expert_id`, `channel`, `whatsapp_status`, `payload jsonb`, `created_at`) with GRANTs and staff-read RLS; mirrors `dispatch_alert_events` so the existing worker can drain WhatsApp rows.
- New function `notify_waitlist_for_expert(_expert_id uuid)`: resolves the expert's segment/skills, city and location, picks eligible waiting rows using `haversine_km` against the city's `dispatch_config` initial radius, respects cooldown/age/once-only, sends push and inserts queue rows, and stamps `notified_at`.
- New `notify_customer_user_push(_user_id, _title, _body, _route)` — the existing push helper is booking-scoped; waitlist rows have no booking, so a user-scoped twin is needed.
- Trigger on `experts` AFTER UPDATE firing `notify_waitlist_for_expert` when `is_online` goes false→true or `is_busy` goes true→false; wrapped in an exception guard so expert updates never fail because of notification errors.
- `src/routes/api/public/hooks/dispatch-alerts.ts` extended to also drain pending `waitlist_notify_events` rows through the existing `sendOpsWhatsApp` placeholder.
- Staff RPC `staff_notify_waitlist_area(_city, _segment_id)` for the manual button, audited like other staff actions; wired through `src/lib/waitlist.functions.ts` and `src/components/waitlist-page.tsx`.

## Not included

- Real WhatsApp delivery (placeholder only, same as dispatch alerts).
- Customer app UI changes; the push deep-links to the existing booking screen.
