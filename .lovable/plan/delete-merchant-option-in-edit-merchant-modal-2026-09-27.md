# Delete merchant option in Edit Merchant modal

## Goal
Super admin can delete a merchant store from the Edit Merchant modal. Soft delete (record kept, hidden everywhere), never hard delete — same pattern as bookings.

## Changes

### 1. Database (one migration)
- Add to `merchants`: `deleted_at timestamptz`, `delete_reason text`.
- New RPC `staff_soft_delete_merchant(_merchant_id uuid, _reason text)`:
  - SECURITY DEFINER, active **super_admin only** (ops manager refused).
  - Sets `deleted_at = now()`, `delete_reason`, `is_accepting_orders = false`, `store_enabled = false`, `delivery_enabled = false` (store instantly disappears from Customer App and Bulk Courier).
  - Writes `audit_logs` with before/after state.
  - Refuses with a clear message if the merchant has **open orders** (merchant_orders or business_orders in active statuses) — those must be resolved/cancelled first.

### 2. Hide deleted merchants everywhere in Command Center
- `listMerchants` (Store → Merchants list): exclude `deleted_at IS NOT NULL`.
- `searchStores` (Bulk Courier "Add business" search): exclude deleted.
- `getMerchantModules` / merchant detail: still readable so an old record can be viewed, but the edit modal shows a "Deleted" state instead of the form.

### 3. Edit Merchant modal (src/components/merchant-edit-modal.tsx)
- Red "Delete store" button at the bottom of the modal (super admin only; ops managers don't see it).
- Opens a confirm step: type-free confirm dialog showing store name, warning text ("Store will be hidden from the app and Bulk Courier. Orders history is kept."), and a required **reason** field.
- On success: toast, modal closes, merchants list refreshes.

## Notes
- No data is erased — orders, wallet, billing and reports keep working; a deleted merchant can be restored later by an admin if ever needed.
- Ops manager: no delete button, RPC refuses them.

## Verification
- Typecheck + build.
- User verifies in preview: delete a test merchant, confirm it vanishes from Merchants list, Bulk Courier search, and the Customer App store list.
