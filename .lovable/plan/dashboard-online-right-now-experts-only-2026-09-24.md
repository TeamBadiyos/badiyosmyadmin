# Dashboard "Online Right Now" — experts only

## Goal
The "Online Right Now" card currently counts online experts **plus** open stores (e.g. "2" = 0 experts + 2 stores). Change it so the card shows **experts only**.

## Changes

### 1. `src/lib/dashboard.functions.ts`
- Change `onlineNow: onlineExperts + openMerchants` → `onlineNow: onlineExperts`.
- Remove the now-unused `openMerchantsRes` query (merchants count) and the `openMerchants` field from the returned stats and the `DashboardStats` type, so no dead data is fetched.

### 2. `src/routes/_authenticated/dashboard.tsx`
- Card hint changes from `"0 experts · 2 stores"` to `"Experts online now"` (or just the expert count text, e.g. `"Available experts"`).
- Card click behaviour unchanged (opens Experts filtered to online).

## Notes
- No other card, table, or RPC is touched. Store "open" status remains visible where it already exists (Commerce/Merchants screens).
- No database or permission changes.
