DO $$
DECLARE d text; n text;
BEGIN
  SELECT pg_get_functiondef('public.staff_dashboard_money'::regproc) INTO d;
  n := replace(d, 'CASE WHEN coalesce(o.total_amount,0)>0 THEN (coalesce(o.commission_amount,0)', 'CASE WHEN coalesce(o.total_amount,0)+coalesce(o.wallet_used,0)>0 THEN (coalesce(o.commission_amount,0)');
  n := replace(n, 'least(o.refund_amount/o.total_amount,1)', 'least((coalesce(o.refund_amount,0)+coalesce(o.wallet_used,0))/(coalesce(o.total_amount,0)+coalesce(o.wallet_used,0)),1)');
  n := replace(n, 'AND coalesce(o.refund_amount,0)>0 AND o.refunded_at >= _f', 'AND (coalesce(o.refund_amount,0)>0 OR (o.refund_status=''done'' AND coalesce(o.wallet_used,0)>0)) AND o.refunded_at >= _f');
  IF n = d OR position('wallet_used,0))/(' in n)=0 OR position('refund_status=''done''' in n)=0 THEN RAISE EXCEPTION 'dashboard pattern not found'; END IF;
  EXECUTE n;

  SELECT pg_get_functiondef('public.staff_cancel_store_order_apply'::regproc) INTO d;
  n := replace(d, '  UPDATE merchant_orders SET status = ''cancelled'', cancelled_at = now(),',
    '  IF coalesce(_mo.wallet_used,0) > 0 AND coalesce(_mo.refund_status,''none'') = ''none'' AND _mo.payment_status = ''paid'' THEN
    PERFORM public.wallet_return(_mo.user_id, ''merchant_order'', _mo.id::text, ''Shop order refund · to badiyos Wallet'');
  END IF;
  UPDATE merchant_orders SET status = ''cancelled'', cancelled_at = now(),');
  IF n = d THEN RAISE EXCEPTION 'cancel pattern not found'; END IF;
  EXECUTE n;

  SELECT pg_get_functiondef('public.fin_issue_invoice'::regproc) INTO d;
  n := replace(d, '''gst_pct'',coalesce((m.tax_rates_snapshot->>''order_delivery_gst'')::numeric,0)', '''gst_pct'',coalesce((m.tax_rates_snapshot->>''order_delivery_gst'')::numeric,public.tax_rate(''order_delivery_gst''))');
  IF n = d THEN RAISE EXCEPTION 'invoice pattern not found'; END IF;
  EXECUTE n;
END $$;

CREATE OR REPLACE FUNCTION public.staff_delivery_gst_check(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; _o numeric := public.tax_rate('order_delivery_gst'); _p numeric := public.tax_rate('parcel_delivery_gst');
BEGIN
  IF public.staff_commerce_admin_id() IS NULL AND NOT public.has_role(public.cc_uid(),'finance') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'date'),'[]'::jsonb) INTO r FROM (
    SELECT jsonb_build_object('service', CASE WHEN m.service_type='food' THEN 'Food' ELSE 'Store' END, 'order_no', o.order_number,
      'date', (o.created_at AT TIME ZONE 'Asia/Kolkata')::date, 'delivery_fee', o.delivery_fee, 'gst_charged', coalesce(o.gst_delivery,0),
      'rate_charged', o.tax_rates_snapshot->>'order_delivery_gst', 'gst_at_rate', round(o.delivery_fee*_o/100,2),
      'difference', coalesce(o.gst_delivery,0)-round(o.delivery_fee*_o/100,2)) x
    FROM merchant_orders o LEFT JOIN merchants m ON m.id=o.merchant_id
    WHERE coalesce(o.delivery_fee,0)>0 AND coalesce(o.is_training,false)=false
      AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
      AND abs(coalesce(o.gst_delivery,0)-round(o.delivery_fee*_o/100,2)) >= 0.01
    UNION ALL
    SELECT jsonb_build_object('service','Parcel','order_no',c.order_code,'date',(c.created_at AT TIME ZONE 'Asia/Kolkata')::date,
      'delivery_fee', c.total_amount-c.gst_amount, 'gst_charged', c.gst_amount, 'rate_charged', c.gst_percent::text,
      'gst_at_rate', round((c.total_amount-c.gst_amount)*_p/100,2), 'difference', c.gst_amount-round((c.total_amount-c.gst_amount)*_p/100,2))
    FROM courier_orders c
    WHERE c.business_merchant_id IS NULL AND (c.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
      AND coalesce(c.gst_percent,0) <> _p
  ) s;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.staff_delivery_gst_check(date,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_delivery_gst_check(date,date) TO authenticated;
ALTER FUNCTION public.staff_delivery_gst_check(date,date) OWNER TO cc_reader;