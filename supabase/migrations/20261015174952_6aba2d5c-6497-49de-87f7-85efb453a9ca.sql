CREATE OR REPLACE FUNCTION public.fin_overview(_from date, _to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; ms date := date_trunc('month', current_date)::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = auth.uid() AND status = 'active' AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'collected', (SELECT coalesce(sum(gross_amount),0) FROM gateway_settlements WHERE settled_at::date BETWEEN _from AND _to),
    'owed_merchants', (SELECT coalesce(sum(net_amount),0) FROM merchant_settlements WHERE status IN ('draft','approved')),
    'owed_workers', (SELECT coalesce(sum(CASE WHEN type = 'debit' THEN -amount ELSE amount END),0) FROM wallet_ledger WHERE owner_type IN ('expert','partner') AND coalesce(wallet_type,'earnings') = 'earnings'),
    'refunds_pending', (SELECT count(*) FROM merchant_orders WHERE refund_status IN ('refund_pending','processing')),
    'refunds_pending_amt', (SELECT coalesce(sum(refund_amount),0) FROM merchant_orders WHERE refund_status IN ('refund_pending','processing')),
    'tax_month', (SELECT coalesce(sum(commission_gst_total + tcs_total + tds_total),0) FROM merchant_settlements WHERE created_at >= ms),
    'other_income', (SELECT coalesce(sum(instant_fee),0) FROM merchant_settlements WHERE created_at::date BETWEEN _from AND _to),
    'expenses_month', (SELECT coalesce(sum(amount),0) FROM operating_expenses WHERE expense_date >= ms),
    'todo', jsonb_build_object(
      'instant_to_pay', (SELECT count(*) FROM merchant_settlements WHERE type = 'instant' AND status = 'approved'),
      'batch_due', extract(isodow FROM (now() AT TIME ZONE 'Asia/Kolkata')) IN (3, 6),
      'refunds_failed', (SELECT count(*) FROM merchant_orders WHERE refund_status = 'failed'),
      'subs_due', (SELECT count(*) FROM vendor_subscriptions WHERE status = 'active' AND next_due_date <= current_date + 7),
      'merchants_no_bank', (SELECT count(*) FROM merchants WHERE deleted_at IS NULL AND status = 'approved' AND (coalesce(bank_account_number,'') = '' OR coalesce(bank_ifsc,'') = '')),
      'experts_no_bank', (SELECT count(*) FROM experts WHERE coalesce(is_active, true) AND (coalesce(bank_account_number,'') = '' OR coalesce(bank_ifsc,'') = '')),
      'company_incomplete', EXISTS (SELECT 1 FROM (VALUES ('company_gstin'),('company_pan'),('company_address')) k(key)
          LEFT JOIN ops_settings o ON o.key = k.key WHERE coalesce(o.value,'') = '')
    )
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.fin_overview(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_overview(date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.fin_set_instant_fee_pct(_pct numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text;
BEGIN
  IF NOT public.is_super_admin_user() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _pct < 0 OR _pct > 10 THEN RAISE EXCEPTION 'Fee must be between 0 and 10%%'; END IF;
  SELECT value INTO b FROM ops_settings WHERE key = 'instant_settlement_fee_pct';
  UPDATE ops_settings SET value = _pct::text, updated_at = now() WHERE key = 'instant_settlement_fee_pct';
  INSERT INTO audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'set_instant_fee_pct', 'ops_settings', NULL, jsonb_build_object('pct', b), jsonb_build_object('pct', _pct));
END $$;
REVOKE ALL ON FUNCTION public.fin_set_instant_fee_pct(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_set_instant_fee_pct(numeric) TO authenticated;