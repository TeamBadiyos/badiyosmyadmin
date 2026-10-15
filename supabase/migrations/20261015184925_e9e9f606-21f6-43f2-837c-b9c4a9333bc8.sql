ALTER TABLE public.merchant_settlements ADD COLUMN IF NOT EXISTS instant_fee_gst numeric NOT NULL DEFAULT 0;

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.settlement_build(uuid,timestamptz,text,date)'::regprocedure);
  d := replace(d, 'DECLARE _sid uuid;', 'DECLARE _fee_gst numeric := 0; _sid uuid;');
  d := replace(d, '_fee := round(_net * _pct / 100, 2);', '_fee := round(_net * _pct / 100, 2);
    _fee_gst := round(_fee * public.tax_rate(''instant_fee_gst'') / 100, 2);');
  d := replace(d, 'tcs_total,tds_total,instant_fee,net_amount,', 'tcs_total,tds_total,instant_fee,instant_fee_gst,net_amount,');
  d := replace(d, '_t.td,_fee,', '_t.td,_fee,_fee_gst,');
  d := replace(d, 'ELSE round(_net-_fee,2) END', 'ELSE round(_net-_fee-_fee_gst,2) END');
  EXECUTE d;

  d := pg_get_functiondef('public.get_settlement_invoice(uuid)'::regprocedure);
  d := replace(d, 'ARRAY[''super_admin'',''ops_manager'']', 'ARRAY[''super_admin'',''ops_manager'',''finance'']');
  d := replace(d, '''instant_fee'', _s.instant_fee, ''net''',
    '''instant_fee'', _s.instant_fee, ''instant_fee_gst'', _s.instant_fee_gst, ''instant_fee_gst_rate'', public.tax_rate(''instant_fee_gst''), ''sac_instant_fee'', (SELECT value FROM public.ops_settings WHERE key=''sac_instant_fee''), ''net''');
  EXECUTE d;

  d := pg_get_functiondef('public.staff_tax_report_ext(date)'::regprocedure);
  d := replace(d, '(SELECT coalesce(round(sum(instant_fee)*coalesce(_r,0)/100,2),0) FROM public.merchant_settlements WHERE paid_at>=_f AND paid_at<_t)',
    '(SELECT coalesce(sum(instant_fee_gst),0) FROM public.merchant_settlements WHERE paid_at>=_f AND paid_at<_t)');
  EXECUTE d;
END $$;