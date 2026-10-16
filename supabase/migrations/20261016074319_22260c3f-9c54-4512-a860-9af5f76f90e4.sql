CREATE OR REPLACE FUNCTION public.staff_dashboard_drill(_service text, _metric text, _from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _res jsonb;
BEGIN
  IF NOT public.is_active_staff(public.cc_uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH b AS (
    SELECT CASE WHEN public.booking_capacity_group(b.service_category_id, b.service_label)='clean' THEN 'maid' ELSE 'wash' END svc,
      'booking' kind, b.id, coalesce(b.booking_number::text, left(b.id::text,8)) num, u.full_name cname, u.phone,
      b.status, b.service_label label,
      coalesce(b.paid_at, CASE WHEN b.razorpay_payment_id IS NOT NULL THEN b.created_at END) paid_at,
      coalesce(b.cancelled_at,b.updated_at) refund_at, b.created_at,
      coalesce(b.price,0)+coalesce(b.discount_amount,0) gross, coalesce(b.discount_amount,0) disc,
      CASE WHEN b.refund_status='refunded' THEN coalesce(b.refund_amount,0) ELSE 0 END refund,
      coalesce(b.total_amount,0) paid
    FROM public.bookings b LEFT JOIN public.users u ON u.id=b.user_id
    WHERE coalesce(b.is_training,false)=false AND b.deleted_at IS NULL
  ), m AS (
    SELECT CASE WHEN mm.service_type='food' THEN 'food' ELSE 'store' END svc, 'merchant' kind, o.id,
      coalesce(o.order_number::text, left(o.id::text,8)) num, o.customer_name cname, o.customer_phone phone,
      o.status, mm.store_name label, o.paid_at, o.refunded_at refund_at, o.created_at,
      coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0) gross,
      greatest(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)
        +coalesce(o.gst_items,0)+coalesce(o.gst_delivery,0)+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0),0) disc,
      coalesce(o.refund_amount,0) refund, coalesce(o.total_amount,0) paid
    FROM public.merchant_orders o JOIN public.merchants mm ON mm.id=o.merchant_id
    WHERE coalesce(o.is_training,false)=false
  ), c AS (
    SELECT 'parcel' svc, 'parcel' kind, o.id, coalesce(o.order_code, left(o.id::text,8)) num,
      coalesce(u.full_name, o.pickup_contact_name) cname, coalesce(o.customer_phone,u.phone) phone,
      o.status::text, 'Parcel' label,
      CASE WHEN o.payment_status='paid' OR o.razorpay_payment_id IS NOT NULL THEN o.created_at END paid_at,
      coalesce(o.cancelled_at,o.updated_at) refund_at, o.created_at,
      coalesce(o.base_amount,0)+coalesce(o.extra_fee,0)+coalesce(o.stops_fee,0)+coalesce(o.platform_fee,0) gross,
      coalesce(o.discount_amount,0) disc, coalesce(o.refund_amount,0) refund, coalesce(o.total_amount,0) paid
    FROM public.courier_orders o LEFT JOIN public.users u ON u.id=o.customer_id
    WHERE o.merchant_order_id IS NULL
  ), a AS (SELECT * FROM b UNION ALL SELECT * FROM m UNION ALL SELECT * FROM c),
  f AS (
    SELECT a.*, CASE WHEN _metric='refund' THEN refund_at WHEN _metric='cancelled' THEN created_at ELSE paid_at END at,
      CASE WHEN _metric='refund' THEN refund WHEN _metric='discount' THEN disc ELSE paid END amount
    FROM a WHERE (_service='all' OR svc=_service) AND (
      (_metric='refund' AND refund>0 AND refund_at>=_f AND refund_at<_t) OR
      (_metric='cancelled' AND lower(status) IN ('cancelled','rejected') AND created_at>=_f AND created_at<_t) OR
      (_metric='discount' AND disc>0 AND paid_at>=_f AND paid_at<_t) OR
      (_metric IN ('orders','gross','net','earning') AND paid_at>=_f AND paid_at<_t)
      OR (_metric='net' AND refund>0 AND refund_at>=_f AND refund_at<_t))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('svc',svc,'kind',kind,'id',id,'num',num,'name',cname,'phone',phone,
    'status',status,'label',label,'at',at,'amount',round(amount,2)) ORDER BY at DESC),'[]'::jsonb) INTO _res FROM (SELECT * FROM f ORDER BY at DESC LIMIT 500) x;
  RETURN _res;
END $function$;
REVOKE ALL ON FUNCTION public.staff_dashboard_drill(text,text,date,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_dashboard_drill(text,text,date,date) TO authenticated;
ALTER FUNCTION public.staff_dashboard_drill(text,text,date,date) OWNER TO cc_reader;