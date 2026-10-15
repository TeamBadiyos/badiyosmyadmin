CREATE OR REPLACE FUNCTION public.staff_tax_report_ext(_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _f timestamptz := (date_trunc('month',_month)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((date_trunc('month',_month)+interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');
        _base jsonb; _r numeric; _extra jsonb;
BEGIN
  _base := public.staff_tax_report(_month);
  SELECT coalesce(rate_pct,18) INTO _r FROM public.tax_settings WHERE key='instant_fee_gst' AND is_active;
  WITH b AS (
    SELECT public.booking_capacity_group(service_category_id, service_label) grp, gst_amount, total_amount
    FROM public.bookings WHERE status='completed' AND coalesce(is_training,false)=false
      AND created_at>=_f AND created_at<_t)
  SELECT jsonb_build_object(
    'maid_gst', coalesce(sum(gst_amount) FILTER (WHERE grp='clean'),0),
    'wash_gst', coalesce(sum(gst_amount) FILTER (WHERE grp='wash'),0),
    'maid_bookings', count(*) FILTER (WHERE grp='clean'),
    'wash_bookings', count(*) FILTER (WHERE grp='wash')) INTO _extra FROM b;
  _extra := _extra || jsonb_build_object(
    'instant_fee', (SELECT coalesce(sum(instant_fee),0) FROM public.merchant_settlements WHERE paid_at>=_f AND paid_at<_t),
    'instant_fee_gst', (SELECT coalesce(round(sum(instant_fee)*coalesce(_r,0)/100,2),0) FROM public.merchant_settlements WHERE paid_at>=_f AND paid_at<_t),
    'expense_input_gst', (SELECT coalesce(sum(gst_paid),0) FROM public.operating_expenses WHERE expense_date>=date_trunc('month',_month)::date AND expense_date<(date_trunc('month',_month)+interval '1 month')::date),
    'expenses_total', (SELECT coalesce(sum(amount),0) FROM public.operating_expenses WHERE expense_date>=date_trunc('month',_month)::date AND expense_date<(date_trunc('month',_month)+interval '1 month')::date),
    'expenses_by_category', (SELECT coalesce(jsonb_object_agg(category, s),'{}'::jsonb) FROM (SELECT category, sum(amount) s FROM public.operating_expenses WHERE expense_date>=date_trunc('month',_month)::date AND expense_date<(date_trunc('month',_month)+interval '1 month')::date GROUP BY category) c));
  RETURN _base || jsonb_build_object('summary', (_base->'summary') || _extra);
END $$;
REVOKE ALL ON FUNCTION public.staff_tax_report_ext(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_tax_report_ext(date) TO authenticated;