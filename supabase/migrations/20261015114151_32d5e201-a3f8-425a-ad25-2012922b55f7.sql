DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.order_bill_core(uuid,jsonb,numeric,numeric)'::regprocedure);
  d := replace(d, $r$_fee := round((_fare->>'delivery_fee')::numeric / (1 + public.tax_rate('delivery_gst')/100.0), 2);$r$,
       $r$_fee := round((_fare->>'base_amount')::numeric + coalesce((_fare->>'extra_fee')::numeric,0) + coalesce((_fare->>'platform_fee')::numeric,0), 2);$r$);
  IF position('base_amount'')::numeric + coalesce' in d) = 0 THEN RAISE EXCEPTION 'order_bill_core patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.store_courier_fare(uuid,numeric,numeric)'::regprocedure);
  d := replace(d, '_gst_pct := public.get_gst_percent();', $r$_gst_pct := public.tax_rate('delivery_gst');$r$);
  d := replace(d, '_total := round(_sub + _gst, 0);', '_total := round(_sub + _gst, 2);');
  EXECUTE d;

  d := pg_get_functiondef('public.courier_quote_internal(uuid,text,uuid,uuid,numeric,numeric,text,integer,integer)'::regprocedure);
  d := replace(d, '_gst_pct := public.get_gst_percent();', $r$_gst_pct := public.tax_rate('delivery_gst');$r$);
  EXECUTE d;
END $$;

UPDATE public.service_settings SET delivery_min_fare = 30 WHERE service_key='food' AND coalesce(delivery_min_fare,0)=0;
UPDATE public.service_settings SET delivery_per_km = 10 WHERE service_key='food' AND coalesce(delivery_per_km,0)=0;