CREATE OR REPLACE FUNCTION public.staff_dashboard_money(_from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
-- Cash basis: money counts on the day it is received (paid_at) and is taken out on the day it is refunded.
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _res jsonb := '{}'::jsonb; _g text; _r record; _rf numeric;
BEGIN
  IF NOT public.is_active_staff(public.cc_uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  FOREACH _g IN ARRAY ARRAY['clean','wash'] LOOP
    SELECT coalesce(sum(coalesce(price,0)+coalesce(discount_amount,0)),0) gross, coalesce(sum(coalesce(discount_amount,0)),0) disc
      INTO _r FROM public.bookings b
     WHERE coalesce(b.is_training,false)=false AND b.deleted_at IS NULL
       AND coalesce(b.paid_at, CASE WHEN b.razorpay_payment_id IS NOT NULL THEN b.created_at END) >= _f
       AND coalesce(b.paid_at, CASE WHEN b.razorpay_payment_id IS NOT NULL THEN b.created_at END) < _t
       AND public.booking_capacity_group(b.service_category_id, b.service_label)=_g;
    SELECT coalesce(sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0)),0) INTO _rf
      FROM public.bookings b
     WHERE coalesce(b.is_training,false)=false AND b.refund_status='refunded' AND coalesce(b.refund_amount,0)>0
       AND coalesce(b.cancelled_at,b.updated_at) >= _f AND coalesce(b.cancelled_at,b.updated_at) < _t
       AND public.booking_capacity_group(b.service_category_id, b.service_label)=_g;
    _res := _res || jsonb_build_object(CASE WHEN _g='clean' THEN 'maid' ELSE 'wash' END,
      jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'refund',round(_rf,2),'net',round(_r.gross-_r.disc-_rf,2)));
  END LOOP;
  FOREACH _g IN ARRAY ARRAY['store','food'] LOOP
    SELECT coalesce(sum(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)),0) gross,
           coalesce(sum(greatest(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)
              +coalesce(o.gst_items,0)+coalesce(o.gst_delivery,0)+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0),0)),0) disc
      INTO _r FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g AND coalesce(o.is_training,false)=false
       AND o.paid_at >= _f AND o.paid_at < _t;
    SELECT coalesce(sum(coalesce(o.refund_amount,0) * CASE WHEN coalesce(o.total_amount,0)>0
             THEN (coalesce(o.total_amount,0)-coalesce(o.gst_items,0)-coalesce(o.gst_delivery,0)-coalesce(o.gst_platform,0))/o.total_amount ELSE 1 END),0) INTO _rf
      FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g AND coalesce(o.is_training,false)=false
       AND coalesce(o.refund_amount,0)>0 AND o.refunded_at >= _f AND o.refunded_at < _t;
    _res := _res || jsonb_build_object(_g, jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'refund',round(_rf,2),'net',round(_r.gross-_r.disc-_rf,2)));
  END LOOP;
  SELECT coalesce(sum(coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0)+coalesce(platform_fee,0)),0) gross,
         coalesce(sum(coalesce(discount_amount,0)),0) disc
    INTO _r FROM public.courier_orders
   WHERE merchant_order_id IS NULL AND (payment_status='paid' OR razorpay_payment_id IS NOT NULL)
     AND created_at>=_f AND created_at<_t;
  SELECT coalesce(sum(coalesce(refund_amount,0) / (1 + coalesce(gst_percent,0)/100.0)),0) INTO _rf
    FROM public.courier_orders
   WHERE merchant_order_id IS NULL AND coalesce(refund_amount,0)>0
     AND coalesce(cancelled_at,updated_at)>=_f AND coalesce(cancelled_at,updated_at)<_t;
  _res := _res || jsonb_build_object('parcel', jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'refund',round(_rf,2),'net',round(_r.gross-_r.disc-_rf,2)));
  RETURN _res;
END $function$;
ALTER FUNCTION public.staff_dashboard_money(date,date) OWNER TO cc_reader;