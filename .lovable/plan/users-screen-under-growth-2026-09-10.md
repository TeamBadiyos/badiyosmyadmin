# Users screen under Growth

Add a "Users" entry in the Growth group of the sidebar that lists every customer, and a detail view showing that customer's full history.

## Users list

Table of all customers with:
- Name, phone, email
- Default address (area / city)
- Joined date, preferred language
- Referral code, number of successful referrals, coins earned
- Total bookings and total amount spent
- Deleted/anonymised badge for removed accounts

Controls: search by name / phone / email, sort by newest or spend, paging (25 per page), and a toggle to include deleted accounts.

## User profile (click a row)

Opens a full profile with:
- Header: name, phone, email, joined date, status
- Summary tiles: total bookings, completed, cancelled, lifetime spend, average rating given, wallet/coin balance
- Addresses: all saved addresses with label, full address, area, city, default marker
- Bookings history: date, service, price, status, expert assigned, payment status — newest first, clickable through to the existing booking details view
- Wallet ledger: every coin/wallet transaction with amount, type, description, date
- Referrals: who referred them, who they referred, reward status per referral
- Support tickets raised by the user with status
- Deletion requests raised for their phone number, if any

## Access

Visible to super admin and ops manager only (same pattern as Referrals). Area partners do not see it.

## Technical notes

- New `src/lib/users.functions.ts` with `listCustomers` (paged, filtered) and `getCustomerProfile` server functions, both behind `requireSupabaseAuth` plus a staff role check like the one in `referrals.functions.ts`.
- Reads from `users`, `addresses`, `bookings`, `wallet_transactions`, `referral_transactions`, `support_tickets`, `account_deletion_requests`; aggregates booking counts/spend in the handler.
- New `src/components/users-page.tsx` (list + detail panel), styled to match `bookings-page.tsx`.
- Register nav key `users` in `NAV_ITEMS`, add to the Growth group `keys`, allow for super_admin and ops_manager, and render in the switch in `src/routes/_authenticated/dashboard.tsx`.
- No database migration expected; if existing RLS blocks staff reads on any of these tables the plan adds a policy for active staff on that table only.
