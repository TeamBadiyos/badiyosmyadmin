# Allow ops managers to void seal stickers

## Goal
Ops managers can void stickers from Courier → Bulk Courier → Seal Stickers. Reason + confirm stays mandatory, and voiding stays blocked after pickup. Create Batch and Assign Batch remain super-admin only. No database changes.

## Current state (verified)
- Backend `staff_seal_void` already allows `super_admin` and `ops_manager` — no DB work needed.
- The block is in two UI-side places only:
  - `src/lib/bulk-courier.functions.ts` — `voidSeal` server function calls `requireSuper`, which throws "Only a super admin can do this" for ops managers.
  - `src/components/seal-stickers-tab.tsx` — the Void button (and its "Can't void once picked up" hint) only renders when `canWrite` (super admin) is true.
- `src/components/bulk-courier-page.tsx` — `SealStickersTab` is only passed `canWrite`; `canOperate` (super admin OR ops manager) is available on the page and already fetched via `getBulkAccess`.

## Changes
1. `src/lib/bulk-courier.functions.ts`
   - In `voidSeal`, replace `requireSuper` with `requireOps` so both roles pass; the backend RPC still enforces roles.
2. `src/components/seal-stickers-tab.tsx`
   - Add a `canVoid` prop (true for super admin or ops manager) alongside `canWrite`.
   - Lookup: gate the Void button, the picked-up warning, and the void modal on `canVoid` instead of `canWrite`.
   - Keep Create Batch and Assign (row action + modal) gated on `canWrite` only.
3. `src/components/bulk-courier-page.tsx`
   - Pass `canOperate` into `SealStickersTab` as `canVoid`.

## Behavior after change
- Super admin and ops manager: can void an available sticker with mandatory reason + confirmation; void still blocked once the order is picked up or the sticker is already void.
- Ops manager: still cannot create or assign batches (button hidden; server fn still enforces super admin).
- Other roles: unchanged (read-only lookup).

## Verification
- Typecheck passes.
- Playwright against the preview: sign in as an ops manager, open Seal Stickers, confirm the Void button appears on an available sticker, attempt a void without reason (blocked) and with reason (succeeds); confirm no Void button appears on a picked-up sticker.
