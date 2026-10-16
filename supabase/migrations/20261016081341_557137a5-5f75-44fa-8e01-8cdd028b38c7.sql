DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.staff_dashboard_money(date,date)'::regprocedure);
  d := replace(d, 'sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0))', 'sum(coalesce(refund_amount,0))');
  d := replace(d, 'sum(coalesce(o.refund_amount,0) * CASE WHEN coalesce(o.total_amount,0)>0
             THEN (coalesce(o.total_amount,0)-coalesce(o.gst_items,0)-coalesce(o.gst_delivery,0)-coalesce(o.gst_platform,0))/o.total_amount ELSE 1 END)', 'sum(coalesce(o.refund_amount,0))');
  IF position('gst_percent,0)/100.0' in d)>0 THEN RAISE EXCEPTION 'patch did not apply'; END IF;
  EXECUTE d;
END $$;
ALTER FUNCTION public.staff_dashboard_money(date,date) OWNER TO cc_reader;