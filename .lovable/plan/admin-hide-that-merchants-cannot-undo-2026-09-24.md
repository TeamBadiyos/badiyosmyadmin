# Admin hide that merchants cannot undo

## What changes
- A product hidden by admin stays hidden, even if the merchant turns it back on in Merchant Hub.
- The Items popup toggle now controls "admin hide" only. The merchant's own on/off setting is left alone.
- Each item shows badges: "Hidden by merchant" and/or "Hidden by admin".

## Database (one migration)
- `products.admin_hidden boolean NOT NULL DEFAULT false`, `products.admin_hidden_reason text`.
- New trigger function `products_guard_admin_hidden()` BEFORE UPDATE (and INSERT) on `products`, following the `merchants_guard_privileged` pattern:
  - Allow if current_user is not authenticated/anon, or auth.role() = service_role, or `is_active_staff(auth.uid(), ['super_admin','ops_manager'])`.
  - Otherwise raise 42501 if `admin_hidden` or `admin_hidden_reason` changed (on INSERT: if admin_hidden = true or reason is set).

## Server (`src/lib/merchants.functions.ts`)
- `listMerchantProducts`: also select `admin_hidden, admin_hidden_reason`; add `adminHidden`, `adminHiddenReason` to `MerchantProduct`.
- `setMerchantProductActive` → replaced by `setProductAdminHidden({ productId, hidden, reason? })`: super_admin only, updates only `admin_hidden` / `admin_hidden_reason` (reason cleared when un-hiding), audit log action `set_product_admin_hidden` with before/after.

## UI (`src/components/merchant-products-modal.tsx`)
- Toggle reflects "visible by admin" (`!adminHidden`); toasts "Hidden by admin" / "Admin hide removed".
- Optional reason prompt when hiding (small inline input/confirm).
- Badges under item name: "Hidden by merchant" (is_active=false, muted) and "Hidden by admin" (admin_hidden=true, destructive tone); show reason as tooltip.
- Header counts: separate "hidden by merchant" and "hidden by admin".

## Out of scope / note
- Customer App and Merchant Hub queries must also filter `admin_hidden = false` for customers and show the admin-hidden state to merchants; those are separate projects — I will give the exact change to apply there.
