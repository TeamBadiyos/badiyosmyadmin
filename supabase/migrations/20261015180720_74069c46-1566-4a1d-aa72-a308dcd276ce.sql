
ALTER FUNCTION public.fin_fy(date) SET search_path=public;
REVOKE EXECUTE ON FUNCTION public.fin_company_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fin_invoice_trg() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.is_active_staff(uuid)','public.staff_list_customer_invoices(date,date,text,text)','public.customer_list_invoices()','public.staff_set_finance_flag(text,boolean)',
  'public.customer_wallet_get()','public.customer_wallet_start_topup(numeric)','public.customer_wallet_pay(text,text,numeric)','public.staff_wallet_overview(text)','public.staff_wallet_ledger(uuid)',
  'public.staff_find_customer(text)','public.staff_wallet_adjust(uuid,text,numeric,text)','public.staff_wallet_refund_in(uuid,text,text,numeric,text)','public.staff_save_wallet_bonus_rule(uuid,jsonb)'] LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
 END LOOP; END $$;
REVOKE EXECUTE ON FUNCTION public.system_confirm_wallet_topup(text,text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_confirm_wallet_topup(text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_set_wallet_topup_order(uuid,text) TO service_role;
ALTER POLICY "staff read credit notes" ON public.customer_credit_notes TO authenticated;
CREATE POLICY "no direct access" ON public.customer_doc_counters FOR SELECT TO service_role USING (true);
