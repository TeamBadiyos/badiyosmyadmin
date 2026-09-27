# Bulk Courier: Seal Stickers + plan field tweaks

## What you'll see

**Courier → Bulk Courier → new "Seal Stickers" tab** (same look as other tabs)
1. **Batches table:** Batch #, Serial range, Total, Business (or "Unassigned"), Available / Used / Void, Created. Row actions: Assign, Export CSV.
2. **Create Batch:** Serial From (pre-filled with the next free serial after the highest existing batch), Serial To, Notes. Shows "This will create N stickers" before Create.
3. **Assign to Business:** dropdown of delivery-enabled businesses, optional sticker charge (₹) with the business's current delivery wallet balance shown. If the wallet is short, a clear red "Not enough balance in the delivery wallet" message.
4. **Export CSV:** downloads `badiyos-seal-batch-<no>.csv` with serial, code, qr_payload, printed_text.
5. **Sticker lookup:** one search box (BDY1045217 / 1045217 / 104521-7). Shows status, business, batch, linked order, receiver, order status. "Void" button with reason + confirm; disabled once the packet is picked up.

**Business detail → Setup: "Stickers" card** — available, used today, avg/day, days of stock left; red "Low stock" badge when stock is under 3 days. Same red badge appears in the Businesses list.

**Pricing Plans:** new "Bill drops per" — Packet (default) / Shop, with helper "Packet = har packet ek delivery. Shop = ek dukaan ek delivery chahe kitne packet ho." Small tag in the plans list.

**Dispatch Plans:** "Min qty" label becomes "Min shops to dispatch" with helper "Kitni alag dukaanon ke orders jama hone par trip nikle".

## Permissions
Same as the rest of Bulk Courier: create batch, assign/charge and void are super admin only; ops manager views, looks up and exports. (Tell me if ops managers should also be able to void.)

## One backend gap
`staff_upsert_pricing_plan` has no parameter for `drop_count_basis`, so "Bill drops per" can't be saved today. I'll add a `_drop_count_basis` parameter (packet/shop, default packet) to that function only — nothing else in it changes. No other database changes; all sticker actions use the existing RPCs.

## Technical details
- `src/lib/bulk-courier.functions.ts`: new server fns — listSealBatches (reads business_seal_batches + sticker status counts + merchant names, read-only), createSealBatch → `staff_seal_create_batch`, assignSealBatch → `staff_seal_assign_batch` (maps INSUFFICIENT_WALLET), exportSealBatch → `staff_seal_batch_export`, lookupSeal → `staff_seal_lookup`, voidSeal → `staff_seal_void`, getSealStock → `business_seal_stock`. listBusinesses adds low-stock flag via business_seal_stock per business. savePricingPlan/listBulkPlans carry drop_count_basis.
- `src/components/bulk-courier-page.tsx`: new SealStickersTab, Stickers card in Setup, badge in business list, pricing field, dispatch label rename.
- CSV built client-side with proper quoting.
