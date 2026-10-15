ALTER TABLE public.staff_users DROP CONSTRAINT staff_users_role_check;
ALTER TABLE public.staff_users ADD CONSTRAINT staff_users_role_check CHECK (role = ANY (ARRAY['super_admin','ops_manager','area_partner','finance']));

CREATE OR REPLACE FUNCTION public.is_finance_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = auth.uid() AND status='active' AND role='finance');
$$;

CREATE OR REPLACE FUNCTION public.fin_mask_phone(_p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN _p IS NULL OR length(regexp_replace(_p,'\D','','g')) < 4 THEN _p
    ELSE 'XXXXXX' || right(regexp_replace(_p,'\D','','g'),4) END;
$$;

-- Finance-relevant functions: let finance in wherever super_admin+ops_manager are allowed.
DO $$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'fin_overview','staff_approve_settlement','staff_confirm_payout_batch','staff_discard_payout_batch','staff_edit_payout_item',
      'staff_generate_merchant_payout_batch','staff_generate_payout_batch','staff_generate_payout_batch_range','staff_generate_subscription_invoices',
      'staff_mark_payout_batch_paid','staff_mark_payout_item_paid','staff_mark_settlement_paid','staff_mark_subscription_invoice_paid',
      'staff_record_payout_payment','staff_retry_store_refund','staff_set_booking_refund','staff_set_merchant_tax_ids','staff_set_payout_item_removed',
      'staff_tax_report','staff_tds_report','staff_store_cancel_refund')
  LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''super_admin'',''ops_manager''', '''super_admin'',''ops_manager'',''finance''');
    d := replace(d, '''super_admin'', ''ops_manager''', '''super_admin'',''ops_manager'',''finance''');
    EXECUTE d;
  END LOOP;
  -- Expenses, subscriptions and TDS deposit marking: super admin or finance.
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('fin_save_expense','fin_delete_expense','fin_save_expense_category','fin_save_subscription','fin_mark_subscription_paid','staff_mark_tds_deposited')
  LOOP
    d := replace(pg_get_functiondef(r.oid), 'IF NOT public.is_super_admin_user() THEN', 'IF NOT (public.is_super_admin_user() OR public.is_finance_staff()) THEN');
    EXECUTE d;
  END LOOP;
  -- Mask customer phone numbers for finance staff in invoice and wallet lists (also flows into PDFs/CSVs).
  SELECT p.oid INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='staff_list_customer_invoices';
  d := replace(pg_get_functiondef(r.oid), 'jsonb_agg(to_jsonb(i) ORDER BY',
    'jsonb_agg(CASE WHEN public.is_finance_staff() THEN to_jsonb(i) || jsonb_build_object(''customer_phone'', public.fin_mask_phone(i.customer_phone)) ELSE to_jsonb(i) END ORDER BY');
  EXECUTE d;
  SELECT p.oid INTO r FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='staff_wallet_overview';
  d := replace(pg_get_functiondef(r.oid), '''phone'',u.phone', '''phone'',CASE WHEN public.is_finance_staff() THEN public.fin_mask_phone(u.phone) ELSE u.phone END');
  EXECUTE d;
END $$;

-- Read access for finance on finance tables.
CREATE POLICY "finance reads gateway settlements" ON public.gateway_settlements FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads gateway items" ON public.gateway_settlement_items FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads sync log" ON public.gateway_sync_log FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads settlements" ON public.merchant_settlements FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads settlement adj" ON public.merchant_settlement_adjustments FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads sub invoices" ON public.merchant_subscription_invoices FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads partner batches" ON public.partner_payout_batches FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads partner lines" ON public.partner_payout_lines FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads ops settings" ON public.ops_settings FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads expenses" ON public.operating_expenses FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads expense categories" ON public.expense_categories FOR SELECT TO authenticated USING (public.is_finance_staff());
CREATE POLICY "finance reads subscriptions" ON public.vendor_subscriptions FOR SELECT TO authenticated USING (public.is_finance_staff());

-- Block finance staff from customer profiles, addresses and SOS/location data at the database level.
CREATE POLICY "finance no customer profiles" ON public.users AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_finance_staff() OR id = auth.uid());
CREATE POLICY "finance no addresses" ON public.addresses AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_finance_staff());
CREATE POLICY "finance no sos" ON public.emergency_alerts AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT public.is_finance_staff());