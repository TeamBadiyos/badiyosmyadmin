INSERT INTO public.tax_settings(key,label,rate_pct,is_active) VALUES
 ('parcel_delivery_gst','Parcel / courier delivery GST',18,true),
 ('order_delivery_gst','Store & Food order delivery GST',18,true),
 ('maid_gst','Maid service GST',5,false),
 ('wash_gst','Car Wash + Bike Wash GST',18,false)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE d text; f text; n int;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.order_bill_compute(text,numeric,numeric,numeric,numeric,numeric,boolean,numeric)',
                           'public.order_bill_core(uuid,jsonb,numeric,numeric)',
                           'public.store_courier_fare(uuid,numeric,numeric)'] LOOP
    d := pg_get_functiondef(f::regprocedure);
    IF position('''delivery_gst''' in d) = 0 THEN RAISE EXCEPTION 'no delivery_gst in %', f; END IF;
    EXECUTE replace(d, '''delivery_gst''', '''order_delivery_gst''');
  END LOOP;

  d := pg_get_functiondef('public.courier_quote_internal(uuid,text,uuid,uuid,numeric,numeric,text,integer,integer)'::regprocedure);
  IF position('''delivery_gst''' in d) = 0 THEN RAISE EXCEPTION 'no delivery_gst in courier_quote_internal'; END IF;
  EXECUTE replace(d, '''delivery_gst''', '''parcel_delivery_gst''');

  d := pg_get_functiondef('public.settlement_build(uuid,timestamptz,text,date)'::regprocedure);
  n := (length(d) - length(replace(d, $x$coalesce(o.refund_status,'') NOT IN ('refunded','pending','processing','initiated')$x$, ''))) / length($x$coalesce(o.refund_status,'') NOT IN ('refunded','pending','processing','initiated')$x$);
  IF n <> 2 THEN RAISE EXCEPTION 'settlement_build filter found % times', n; END IF;
  EXECUTE replace(d, $x$coalesce(o.refund_status,'') NOT IN ('refunded','pending','processing','initiated')$x$,
                     $x$coalesce(o.refund_status,'none') NOT IN ('refund_pending','processing','done','failed')$x$);
END $$;

DELETE FROM public.tax_settings WHERE key IN ('delivery_gst','clean_gst');