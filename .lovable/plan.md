# Store orders with rider — Commerce board upgrade

## What was found
- Store orders (`merchant_orders`) have **no rider link** and **no step timestamps** (no accepted / ready / picked-up time). Only `created_at`, `updated_at`, `cancelled_at`.
- Riders today only exist on Courier orders (`courier_orders.assigned_expert_id`, `picked_up_at`) with a working dispatch/offer system.
- Only 1 store order exists (completed), so nothing live to break.

So the rider info and the red alerts need a small database addition first. This plan links each store order to a Courier delivery order, reusing the existing rider dispatch.

## What you will see
Each card on the Commerce board shows:
- Store name, customer name, order number, amount
- Rider name, or "Finding rider" (amber), or "No rider yet" before Ready
- Status and "12 min ago" style time since placed (updates every 30 sec)

Red alert (red border + reason chip) when:
- Pending and merchant has not accepted within 5 min -> "Merchant not accepting"
- Rider search ran out / no rider found -> "No rider found"
- Ready for 20+ min and not picked up -> "Pickup delayed"
A counter of red cards appears in the board header; the alert beep also rings for red cards.

Clicking a card opens a small detail panel with two admin buttons (super admin and ops manager only):
- **Reassign rider** — list of eligible nearby riders, pick one.
- **Cancel + full refund** — confirm dialog with reason; refunds the full paid amount via Razorpay (cash orders just get cancelled), cancels the linked delivery.
Both actions are written to the audit log with before/after state.

## Technical details
Migration (additive only):
- `merchant_orders`: `accepted_at`, `ready_at`, `picked_up_at`, `courier_order_id uuid` (FK courier_orders), `refund_id`, `refund_status`, `refund_amount`.
- Trigger on `merchant_orders` status change stamps accepted_at/ready_at (backfill from updated_at where status already past).
- `courier_orders` gets `merchant_order_id uuid`; trigger mirrors courier `picked_up_at` / rider into the store order.
- Security-definer RPCs, gated via `courier_is_ops_staff()` + role in (super_admin, ops_manager), each writing `audit_logs`:
  - `staff_reassign_store_rider(_order_id, _expert_id)` — updates linked courier order's rider.
  - `staff_cancel_store_order_apply(_order_id, _reason, _refund_id, _refund_status, _refund_amount)` — cancels store order + linked courier order.
- GRANT EXECUTE to authenticated.

Server functions (`src/lib/commerce.functions.ts`):
- `listCommercePipeline` extended: customer name, rider name, courier dispatch state (`dispatch_exhausted`/search status), accepted/ready/picked timestamps; alert flags computed server-side.
- `listStoreOrderRiders` (eligible riders via existing `courier_eligible_riders` on the linked courier order).
- `reassignStoreRider`, `cancelStoreOrderWithRefund` (Razorpay fetch -> refund captured amount using existing RAZORPAY keys, then apply RPC; failed refund still cancels with refund_status='failed', same as bookings).

UI (`src/components/commerce-kanban.tsx`): richer card, red alert styling, header counter, detail sheet with the two actions, realtime also on `courier_orders`.

## Outside this project
Store orders only get a rider if the Merchant Hub / Customer App creates the linked delivery when the order is marked Ready. Until then cards will show "Finding rider" / "No rider found" after Ready. I can add an automatic DB trigger that creates the courier delivery on Ready if you want — tell me and I'll include it.
