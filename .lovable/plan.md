# Dispatch alerts and capacity-aware messaging

Two additions, both purely additive — no change to booking states. Today a booking that nobody accepts just sits there silently until the 30-minute auto-cancel, and a customer in an empty zone sees an endless "searching" screen.

## What counts as "waiting for an expert"

There is no separate pending-assignment state in the system. The equivalent is: booking is live, payment done, broadcast started, no expert assigned yet. The timer runs from `broadcast_started_at`. Nothing about the state machine changes.

## Feature A — No-accept timeout alert

- New per-city setting `no_accept_alert_threshold_seconds` (default 180) on the existing dispatch settings row, same pattern as the other dispatch fields.
- A per-minute background check (reusing the existing stale-booking cron path) finds bookings waiting longer than the threshold with nobody assigned and fires the alert **once per booking** (a flag on the booking already exists for this, plus the alert-history table below prevents duplicates).
- Each alert does two things:
  1. Writes a Command Center notification (new kind `dispatch`), so it appears in the bell with unread/dismiss/clear and clicking it opens that booking — using the existing notification machinery.
  2. Calls a WhatsApp sender that, for now, **only logs** the recipient numbers, template name and message payload. The real AiSensy call is a single clearly-marked spot to swap in later.

## Feature B — Capacity-aware customer messaging

**Where the check runs:** server-side, right after the booking is created/paid — not in the customer app. It is one call that returns the capacity verdict plus the message to show, so the customer app only renders what the server tells it and Admin edits stay authoritative.

**How "almost available" is detected:** for every busy expert who is online, eligible for the booking's category and inside the search radius, the expected free-at time is their job's start time plus its booked duration. If that lands within the configurable window (default 10 minutes), the zone counts as "almost available".

- **Case 1 — genuine zero capacity** (nobody online/eligible and nobody finishing soon): the server returns `zero_capacity` plus the active admin-written message for that city. The customer app shows it with three choices — join waitlist (existing waitlist table), schedule for later, or cancel. This also fires the same bell notification + WhatsApp placeholder as Feature A, tagged as a zero-capacity event.
- **Case 2 — almost available**: nothing special for the customer, normal searching flow continues. Internally the soon-to-be-free expert is recorded as a preferred candidate for that booking and is offered the job first the moment they finish, before the broadcast widens.

## Command Center screens

**Settings → Dispatch Alerts** (per city):
- No-accept threshold in minutes
- AiSensy template name — plain free-text box
- WhatsApp numbers that receive ops alerts (add/remove list)

**Settings → Capacity Messages** (per city):
- Default zero-capacity message text
- Situational override messages (e.g. "heavy rain") with one togglable as active; the active override wins over the default
- "Almost available" window in minutes (default 10)

## Technical notes

- Migration adds: `dispatch_config.no_accept_alert_threshold_seconds` (int, default 180), `aisensy_template_name` (text), `ops_alert_whatsapp_numbers` (text[]), `almost_available_window_minutes` (int, default 10).
- New table `capacity_messages` (`id`, `message_key`, `message_text`, `city`, `is_active`, timestamps) with GRANTs, staff-only writes, and public/anon read of active rows only.
- New table `dispatch_alert_events` (`id`, `booking_id`, `alert_type` enum-ish text `no_accept` | `zero_capacity`, `city`, `zone_id`, `payload jsonb`, `triggered_at`) with a unique index on (`booking_id`, `alert_type`) for once-per-booking, GRANTs, staff-read RLS. This is the history for later per-city reporting.
- New table `booking_preferred_experts` (`booking_id`, `expert_id`, `expires_at`) for Case 2 priority; `broadcast_booking_to_experts` checks it first and only widens after the preference expires.
- DB functions: `evaluate_zone_capacity(_booking_id)` returning the verdict + resolved message; `raise_dispatch_alert(_booking_id, _type)` doing dedupe + notification insert + WhatsApp hook; `staff_sync_notifications` extended to include the new `dispatch` kind.
- WhatsApp: `src/lib/whatsapp.server.ts` exposing `sendOpsWhatsApp({ numbers, template, params })` — currently `console.info` only, with the AiSensy fetch stubbed behind one function body. Called from the cron route handler in `src/routes/api/public/hooks/`, which also processes pending rows in `dispatch_alert_events` (DB triggers cannot call external APIs).
- New server functions: `src/lib/dispatch-alerts.functions.ts` (settings read/update, alert history) and `src/lib/capacity.functions.ts` (message CRUD, plus a public capacity-check function the customer app calls).
- New screens `src/components/dispatch-alerts-page.tsx` and `src/components/capacity-messages-page.tsx`, wired into the Settings group in `src/routes/_authenticated/dashboard.tsx`.

## Not included

- Real AiSensy delivery (placeholder only, as requested).
- Customer app UI for the three zero-capacity options — that lives in the separate customer app; this work exposes the server call, the message text and the waitlist entry point it needs.
