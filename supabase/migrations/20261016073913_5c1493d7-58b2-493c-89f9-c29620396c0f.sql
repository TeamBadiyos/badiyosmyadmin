DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.staff_dashboard_money(date,date)'::regprocedure);
  -- bookings: paid count + earning
  d := replace(d, 'SELECT coalesce(sum(coalesce(price,0)),0) gross, coalesce(sum(coalesce(discount_amount,0)),0) disc',
    'SELECT coalesce(sum(coalesce(price,0)),0) gross, coalesce(sum(coalesce(discount_amount,0)),0) disc, count(*) n, coalesce(sum(coalesce(price,0)-coalesce(snapshot_expert_payout,0)-coalesce(snapshot_partner_payout,0)),0) earn');
  d := replace(d, 'SELECT coalesce(sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0)),0) INTO _rf
      FROM public.bookings b',
    'SELECT coalesce(sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0)),0),
            coalesce(sum(CASE WHEN coalesce(total_amount,0)>0 THEN (coalesce(price,0)-coalesce(snapshot_expert_payout,0)-coalesce(snapshot_partner_payout,0))*least(refund_amount/total_amount,1) ELSE 0 END),0) INTO _rf, _re
      FROM public.bookings b');
  -- merchant orders
  d := replace(d, '+coalesce(o.gst_items,0)+coalesce(o.gst_delivery,0)+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0),0)),0) disc',
    '+coalesce(o.gst_items,0)+coalesce(o.gst_delivery,0)+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0),0)),0) disc, count(*) n,
           coalesce(sum(coalesce(o.commission_amount,0)+greatest(coalesce(o.delivery_fee,0)-coalesce(o.rider_share_amount,0),0)+coalesce(o.platform_fee,0)),0) earn');
  d := replace(d, 'THEN (coalesce(o.total_amount,0)-coalesce(o.gst_items,0)-coalesce(o.gst_delivery,0)-coalesce(o.gst_platform,0))/o.total_amount ELSE 1 END),0) INTO _rf',
    'THEN (coalesce(o.total_amount,0)-coalesce(o.gst_items,0)-coalesce(o.gst_delivery,0)-coalesce(o.gst_platform,0))/o.total_amount ELSE 1 END),0),
           coalesce(sum(CASE WHEN coalesce(o.total_amount,0)>0 THEN (coalesce(o.commission_amount,0)+greatest(coalesce(o.delivery_fee,0)-coalesce(o.rider_share_amount,0),0)+coalesce(o.platform_fee,0))*least(o.refund_amount/o.total_amount,1) ELSE 0 END),0) INTO _rf, _re');
  -- courier
  d := replace(d, 'coalesce(sum(coalesce(discount_amount,0)),0) disc
    INTO _r FROM public.courier_orders',
    'coalesce(sum(coalesce(discount_amount,0)),0) disc, count(*) n,
         coalesce(sum((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))*coalesce(commission_pct,0)/100+coalesce(platform_fee,0)),0) earn
    INTO _r FROM public.courier_orders');
  d := replace(d, 'SELECT coalesce(sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0)),0) INTO _rf
    FROM public.courier_orders',
    'SELECT coalesce(sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0)),0),
          coalesce(sum(CASE WHEN coalesce(total_amount,0)>0 THEN ((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))*coalesce(commission_pct,0)/100+coalesce(platform_fee,0))*least(refund_amount/total_amount,1) ELSE 0 END),0) INTO _rf, _re
    FROM public.courier_orders');
  d := replace(d, '_r record; _rf numeric;', '_r record; _rf numeric; _re numeric;');
  d := replace(d, '''net'',round(_r.gross-_r.disc-_rf,2))', '''net'',round(_r.gross-_r.disc-_rf,2),''orders'',_r.n,''earning'',round(_r.earn-_re,2))');
  IF position('_re numeric' in d)=0 OR (length(d)-length(replace(d,'INTO _rf, _re','')))/length('INTO _rf, _re') <> 3
     OR (length(d)-length(replace(d,' earn','')))/5 < 3 THEN RAISE EXCEPTION 'patch did not apply'; END IF;
  EXECUTE d;
END $$;
ALTER FUNCTION public.staff_dashboard_money(date,date) OWNER TO cc_reader;