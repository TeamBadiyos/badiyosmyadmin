# Vehicle Insurance Tracking (manual entry, v1)

## What I checked in the live database
- `users` has `id, full_name, phone, email, deleted_at`. There are 278 phones, saved in mixed formats (`+918600801188` and `8265013057`). To match a vehicle to a customer, I'll compare the last 10 digits and skip deleted users.
- No `vehicles` or `vehicle_leads` tables exist yet. `audit_logs`, `experts` and `staff_users` exist and will be reused.

## Access
- Only super_admin and ops_manager. Other staff don't see the menu, and the database blocks them too.
- Nothing is ever deleted. Vehicles get archived, and an "Archived" filter shows them.

## Database (one migration)
1. **vehicles**: customer_name, customer_phone (10 digits, checked), user_id (filled in automatically by phone match), reg_number (uppercase, no spaces, UNIQUE), vehicle_type (car/bike), make_model, insurer, insurance_expiry, puc_expiry, consent_reminder (bool), source (default `whatsapp_expert`), expert_id, booking_id, photos (text[] of storage paths), archived, created_by, created_at, updated_at.
2. **vehicle_leads**: one per vehicle, created automatically. Fields: status (new/called/quote_sent/renewed/lost), next_followup_date, assigned_to (staff_users), renewed_at, timestamps.
3. **vehicle_lead_notes**: an add-only history of who did what and when (lead_id, author, text, created_at), plus automatic notes for status and assignment changes.
4. **Audited functions** that write to audit_logs with before/after: `staff_upsert_vehicle` (cleans the phone and number, matches the user, returns the existing vehicle when the number is a duplicate), `staff_set_vehicle_archived`, `staff_update_vehicle_lead` (status, follow-up, assignee, note), and `staff_insurance_stats` (due this month, renewed this month, conversion %).
5. **Security rules**: staff role checks, read access for ops staff, and all writes only through the functions above.
6. **Private bucket** `vehicle-docs`: ops staff can upload and read. Photos open through short-lived signed links.

## Screens: new "Insurance" section (under Growth)
- **Add vehicle**: a form that follows the WhatsApp format (name, mobile, gaadi number, car/bike, company/model, insurer, insurance expiry, PUC expiry, consent yes/no, Expert dropdown, photos). If the number already exists, a toast says so and that vehicle opens instead.
- **Vehicles list**: search by name, mobile or number. Filters for type, insurer, status, consent and archived. **Export CSV** downloads the current filter.
- **Expiry board**: columns Expired | 7 | 15 | 30 | 60 days. Each card shows customer, number, expiry, status, a Call button, and a WhatsApp (wa.me) button.
- **Aaj ke follow-ups**: leads due today or overdue, oldest first.
- **Lead detail**: change status, add a note, set the next follow-up, assign staff, see the note history, view photos, edit the vehicle, and archive or restore.
- **No consent**: shows a grey "No consent" badge and hides the WhatsApp button everywhere.
- **Dashboard**: an Insurance strip with Due this month, Renewed this month and Conversion %.

## Technical notes
- New `src/lib/insurance.functions.ts` (requireSupabaseAuth plus role check) and `src/components/insurance-page.tsx` with tabs. A nav entry goes in dashboard.tsx.
- Conversion % = renewed this month ÷ insurance due this month.
- Verification: build/typecheck and database checks. You'll need to test it on your own staff login.
