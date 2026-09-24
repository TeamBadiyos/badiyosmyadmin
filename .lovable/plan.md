# Commerce board: switch to backend admin functions

## What changes for you
- **Cancel + refund** calls the backend's `staff_store_cancel_refund`. It cancels the order, cancels the delivery, puts stock back and marks the refund. The Command Center stops calling Razorpay itself, so there's only one refund path and no risk of a double refund. You still have to enter a reason.
- **Reassign rider** calls the backend's `staff_store_reassign`. This function doesn't let you pick a rider. It restarts the automatic rider search, or creates a new delivery job if the old one was cancelled or missing. So the "pick a nearby rider" list goes away and one **"Re-search rider"** button replaces it. It includes a short note saying the nearest free rider will be offered the job.
- **Reassign is enabled** on any paid, open order, even when it has no delivery job yet, because the backend creates one when needed. If the backend refuses, for example because a rider is already on the way, you'll see a clear message ("Can't reassign at this stage").

## Technical details
- `src/lib/commerce.functions.ts`
  - `reassignStoreRider`: input `{ orderId }` only; `context.supabase.rpc("staff_store_reassign", { _order_id })`.
  - `cancelStoreOrderWithRefund`: remove all Razorpay fetch logic; `context.supabase.rpc("staff_store_cancel_refund", { _order_id, _reason })`. Map errors `order_not_cancellable`, `order_not_reassignable`, `reason_required`, and `Forbidden` to friendly messages.
  - Stop importing or calling `listStoreOrderRiders` from the UI (the function stays in the file).
- `src/components/commerce-kanban.tsx`: remove the rider radio list and `fetchRiders` query. The Reassign button is enabled when the order is paid and not delivered, completed, cancelled or rejected. Cancel + refund stays as it is, with the reason field required.
- Both RPCs are gated by `is_active_staff(super_admin, ops_manager)` and write their own audit entries. No database changes.

## Now unused (report only, nothing dropped)
- SQL: `staff_reassign_store_rider`, `staff_cancel_store_order_apply`, `staff_commerce_admin_id` (the helper used only by those two).
- Server code: the Razorpay refund logic in `cancelStoreOrderWithRefund` (removed from the code path) and the server function `listStoreOrderRiders` (the file keeps it, but nothing calls it any more).
- Kept in use: the new columns (`accepted_at`, `ready_at`, `picked_up_at`, `courier_order_id`, `refund_*`, `courier_orders.merchant_order_id`) and the triggers `merchant_orders_stamp_steps` / `courier_orders_sync_merchant_order`. The backend functions rely on `courier_order_id`. I haven't checked whether they also write `refund_*` or stamp the step times through their own triggers. I'll check both before calling these columns and triggers "still needed".
