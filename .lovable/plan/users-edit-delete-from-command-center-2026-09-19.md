# Users — Edit & Delete from Command Center

## Goal
Growth → Users tab me har user ke liye Edit aur Delete options. Sirf Super Admin kar sakta hai; Ops Manager read-only rahega (buttons hidden). Har action activity log me before/after ke saath jayega.

## Decisions (confirmed)
- Editable fields: sirf **Name, Email, Preferred Language** — phone editable nahi (login/OTP identity hai).
- Delete: **dono options** — soft delete (default, restore possible) + permanent delete (sirf Super Admin, typed confirmation).
- Access: sirf **super_admin** (existing role-checked staff RPC pattern se, role-blind `is_active_staff` nahi).

## Database (migration — naye RPCs, koi naya table nahi)
1. `staff_update_user(_user_id, _full_name, _email, _preferred_language)`
   - Gate: caller `staff_users` me active super_admin.
   - Validation: non-empty name; email format check; language in ('en','hi').
   - before/after snapshot `audit_logs` me; `updated_at = now()`.
2. `staff_set_user_deleted(_user_id, _deleted boolean)` — soft delete / restore
   - Soft delete: `deleted_at = now()`; restore: `deleted_at = null`. Audit both.
   - Safety: active (non-completed/non-cancelled) bookings wale user ko delete karne par blocking error, taaki live booking orphan na ho.
3. `staff_permanently_delete_user(_user_id, _confirm_phone text)` — sirf super admin
   - Confirm: caller ko user ka phone number type karna hoga (typed confirmation).
   - Deletes: user row, addresses, device_tokens, device_sessions, deletion requests, support tickets, customer_coupons.
   - Financial history (bookings, wallet_ledger, wallet_transactions, referral rows) accounting/payout ke liye retain hoti hai, lekin PII anonymize hoti hai (name/phone/email masked) — permanent delete sirf tab full jab koi financial history na ho.
   - Auth identity (Supabase Auth user) bhi remove hoti hai taaki purana phone dobara signup ke liye free ho.
   - Full audit entry.
4. EXECUTE grants: `authenticated` (function khud role-gate karta hai), revoke PUBLIC/anon.

## UI — `src/components/users-page.tsx`
- List rows me actions column: **Edit** (pencil), **Deactivate/Restore**, **Delete forever** (sirf super admin ko dikhenge — role server se aata hai).
- Edit modal: Name, Email, Language dropdown; save par success toast + list refresh.
- Deactivate: confirm dialog ("user app me login nahi kar payega, data safe rahega"); Restore same control se.
- Delete forever: red dialog — user ka phone type karna zaroori, warning ki PII permanently mit jayegi.
- Customer profile panel me bhi same actions header me.
- Soft-deleted users par "Deleted" badge + Restore button (Include deleted toggle already exists).

## Server functions — `src/lib/users.functions.ts`
- `getStaffUserRole()` — page ko batane ke liye caller super_admin hai ya nahi (buttons show/hide).
- `updateUser()`, `setUserDeleted()`, `permanentlyDeleteUser()` — sab `requireSupabaseAuth` + super_admin gate, upar ke RPCs ko call.

## Files changing
- Migration: 3 naye audited RPCs + grants.
- `src/lib/users.functions.ts` (new fns)
- `src/components/users-page.tsx` (actions column, modals, badges)

## Notes
- Phone number deliberately editable nahi — OTP login usi se hota hai.
- Ops Manager ko ye buttons dikhenge hi nahi.
- Verify: tsgo typecheck. Authenticated browser test possible nahi (external Supabase), aap preview me ek test user par try kar lijiyega.
