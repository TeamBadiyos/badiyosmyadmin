# Merchant wallet_type = 'earnings' audit

## What I checked
Every place this app touches `wallet_ledger` or `staff_wallet_adjust`:

| Place | Reads which owners | Merchant rows? |
|---|---|---|
| Wallets & Payouts, balances list (`listWalletOwners`) | Uses area partner rows only for derived balances; experts use `experts.wallet_balance` | No |
| Wallets & Payouts, ledger drawer (`listOwnerLedger`) | `expert` / `area_partner` only (typed input) | No |
| Reports, expert performance earnings | `owner_type = 'expert'` | No |
| Merchant Billing | Reads `merchant_subscription_invoices` and `merchant_fee_tiers`, not the ledger | No |
| Merchant payouts (Wallets & Payouts, merchant batches) | Reads `payout_batch_items`; the batch is built by backend `staff_generate_merchant_payout_batch`, which already filters on `wallet_type` | Already handled |
| `staff_wallet_adjust` (Adjust button) | Function rejects anything except `expert` / `area_partner`; inserts use the column default `'earnings'` | Cannot be called for a merchant |

## Result
Nothing in this app reads or sums merchant `wallet_ledger` rows, and it cannot call `staff_wallet_adjust` for a merchant (the function refuses it, and any insert would default to `earnings` anyway).

## Proposed change (small safety net, no behavior change)
1. In `listWalletOwners`, narrow the ledger read to `owner_type = 'area_partner'` and `wallet_type = 'earnings'`, so a merchant delivery row can never enter any balance sum in the future.
2. No change to `staff_wallet_adjust`, Merchant Billing, reports, RPCs, permissions or the database.

If you prefer zero code changes, skip this plan and nothing will be edited.
