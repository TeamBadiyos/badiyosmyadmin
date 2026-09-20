# Support ko WhatsApp-jaisa chat window banana

Abhi Support Tickets screen ek card list hai — sirf pehla message dikhta hai aur reply ka koi option nahi. Isko poora chat inbox bana denge.

## Naya layout (3 columns)

```text
+---------------+--------------------------+-------------------+
| Ticket list   | Chat window              | Customer panel    |
| search +      | customer msg (left)      | naam, phone, mail |
| status filter | hamara reply (right)     | joined, language  |
| last msg      | date separators, time    | address           |
| unread dot    | ---------------          | wallet/coins      |
|               | composer + Mark resolved | recent bookings   |
+---------------+--------------------------+-------------------+
```

### Ticket list (left)
- Har ticket: customer naam, phone, aakhri message ka preview, time, status pill (Open / In progress / Answered / Resolved), source badge (Customer / Partner / Merchant).
- Search (naam/phone/message) + status filter. Naya message aate hi list upar aa jaye (realtime).

### Chat window (beech me)
- WhatsApp jaisa: customer ke messages baayein (halka grey bubble), hamare reply daayein (Badiyos green bubble), har bubble ke neeche time, din ke hisaab se "Aaj / Kal / 20 Sept" separator.
- Sabse upar ticket ka original subject/message pinned.
- Neeche composer: type karke Enter ya Send — message turant dikhe (optimistic), customer ke app me push notification chala jaye (ye pehle se backend me hai).
- Internal note alag rahega — staff-only, customer ko nahi dikhta.
- Header me actions: In progress, Mark resolved.

### Mark resolved
- Resolve karte hi chat band: composer disabled ho jaye aur uski jagah "Ticket resolved — 20 Sept, 12:08 pm" strip dikhe, saath me **Reopen** button.
- Customer bhi resolved ticket par reply na kar sake; usko naya ticket kholna padega. (Abhi customer ka message resolved ticket ko chupke se dobara open kar deta hai — wo band karenge.)
- Resolve hone par customer ko "resolved" notification pehle se jaati hai, wo waisi hi rahegi.

### Customer panel (daayein)
- Personal: naam, phone, email, joined date, language, deleted badge.
- Default address.
- Wallet / coins balance, total bookings, lifetime spend.
- Recent bookings list (date, service, amount, status) — click par existing booking details khul jaye.
- Expert/merchant se aaye tickets par wahi profile jo uplabdh ho (naam, phone, role badge) — inke liye booking history ki jagah role-specific info.

## Access
Pehle jaisa hi — sirf Super Admin aur Ops Manager. Area Partner ko screen dikhti hi nahi.

## Technical notes

- Messaging backend already exists: `support_ticket_messages` table, `support_ticket_message_after_insert` trigger (last_message_at, unread flags, push to customer), `support_mark_ticket_read`. Koi naya table nahi banega.
- Migration (chhoti):
  - `staff_send_support_message(_ticket_id, _body)` — SECURITY DEFINER, `is_active_staff(auth.uid(), ['super_admin','ops_manager'])` gate, resolved ticket par error, insert + audit_logs (before/after).
  - `staff_update_support_ticket` me `'answered'` ko valid status maana jaye (trigger already ye status set karta hai, par RPC use reject karta hai).
  - Trigger me customer message ka auto-reopen hata kar: resolved ticket par customer insert block (RLS with_check me `status <> 'resolved'`).
- `src/lib/support.functions.ts`: `listSupportTickets` me last message preview/time/unread add; naye fns `listTicketMessages`, `sendTicketMessage`, `getTicketContact` (users/experts/merchants + address, wallet, bookings — `users.functions.ts` ke `getCustomerProfile` pattern par).
- `src/components/support-tickets-page.tsx` poora naya 3-column layout; Realtime subscription `support_ticket_messages` INSERT par (existing tickets channel ke saath).
- Tokens wahi: Badiyos Green #00B97A, Nunito Sans, 8pt grid, rounded-[18px] cards.
