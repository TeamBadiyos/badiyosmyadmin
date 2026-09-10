# Ask which account type is being deleted

Add an "Account type" question to the public delete-account form and show it to staff.

## On the public page (badiyos.com/delete-account)

- New required field above the phone number: **Which account do you want to delete?**
- Options: Customer, Expert (Partner), Merchant (Shop owner).
- Shown as three selectable pills so it is one tap, no dropdown hunting.
- The form cannot be submitted until one is chosen.

## In Command Center (Settings → Deletion Requests)

- Each request card shows a badge with the account type next to the phone number.
- New filter next to the Status filter: All types / Customer / Expert / Merchant.

## Technical notes

- Migration: add `account_type text not null default 'customer'` to `public.account_deletion_requests`, with a validation constraint allowing `customer`, `expert`, `merchant`. Existing rows default to `customer`.
- `src/lib/account-deletion.functions.ts`: add `accountType` to the submit Zod schema (enum, required), insert it; add it to the `DeletionRequest` type, the select list, and the row mapping; accept an optional `accountType` filter in `listDeletionRequests`.
- `src/routes/delete-account.tsx`: add the pill selector state and required validation in `DeletionForm`, pass `accountType` in the submit payload.
- `src/components/deletion-requests-page.tsx`: type filter select, badge on each card.
- No change to the in-app deletion flow or to what data is deleted/retained.
