# Replace hardcoded Supabase URL with api.badiyos.com

Only these 4 functions in the database still contain the old address, one time each:

- `_send_action_otp(text)`
- `notify_data_push(text, uuid, jsonb)`
- `notify_push_event(text, uuid, text, text, text, jsonb)`
- `send_daily_go_live_reminder()`

## Change

In each function, swap `https://dkneclwmmjlqswovtqno.supabase.co` for `https://api.badiyos.com`. The rest of each URL stays exactly as it is (`/functions/v1/send-otp`, `/functions/v1/send-push-notification`).

## Technical details

- One migration with a DO block. For each signature, it reads `pg_get_functiondef(oid)`, applies `replace()` for that host only, and runs `EXECUTE` on the result.
- `pg_get_functiondef` reproduces the full original definition, so logic, headers, `SECURITY DEFINER`, `search_path` and other settings stay the same. `CREATE OR REPLACE` keeps the existing grants and owner.
- The migration fails if any of the 4 functions is missing or still contains the old ref after the replace.
- Afterwards, I'll run a query across all function bodies in schema `public` to confirm none still contain `dkneclwmmjlqswovtqno` (the expected count is 0).

Nothing else changes.
