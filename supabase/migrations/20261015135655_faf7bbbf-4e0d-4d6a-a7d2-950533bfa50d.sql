-- refund completion timestamp for credit notes
ALTER TABLE public.merchant_orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
UPDATE public.merchant_orders SET refunded_at = updated_at WHERE refund_status='done' AND refunded_at IS NULL;
CREATE OR REPLACE FUNCTION public.merchant_orders_stamp_refunded() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.refund_status='done' AND coalesce(OLD.refund_status,'')<>'done' AND NEW.refunded_at IS NULL THEN NEW.refunded_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_merchant_orders_stamp_refunded ON public.merchant_orders;
CREATE TRIGGER trg_merchant_orders_stamp_refunded BEFORE UPDATE OF refund_status ON public.merchant_orders
  FOR EACH ROW EXECUTE FUNCTION public.merchant_orders_stamp_refunded();

CREATE OR REPLACE FUNCTION public.staff_dashboard_overview(_from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((_to+1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _riders jsonb; _svc jsonb := '{}'::jsonb; _g text; _r record; _util numeric; _daily jsonb; _alerts jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  _riders := public.rider_pool_stats();

  FOREACH _g IN ARRAY ARRAY['clean','wash'] LOOP
    SELECT count(*) FILTER (WHERE status='completed') completed,
           count(*) FILTER (WHERE status NOT IN ('completed','cancelled','rejected','expired')) active,
           count(*) FILTER (WHERE status IN ('cancelled','rejected')) cancelled,
           coalesce(sum(total_amount) FILTER (WHERE status='completed'),0) gmv,
           coalesce(sum(coalesce(total_amount,0)-coalesce(gst_amount,0)-coalesce(snapshot_expert_payout,0)-coalesce(snapshot_partner_payout,0)) FILTER (WHERE status='completed'),0) earn
      INTO _r FROM public.bookings b
     WHERE coalesce(b.is_training,false)=false AND b.scheduled_date BETWEEN _from AND _to
       AND public.booking_capacity_group(b.service_category_id, b.service_label) = _g;
    SELECT CASE WHEN sum(cap)>0 THEN round(sum(LEAST(bk,cap))::numeric*100/sum(cap),0) END INTO _util FROM (
      SELECT d.d, sl.m, public.slot_capacity_for(_g, d.d) cap,
             coalesce((SELECT busy FROM public.slot_busy_by_half(_g, d.d) z WHERE z.start_min=sl.m),0) bk
        FROM generate_series(_from, _to, interval '1 day') d0(dd)
        CROSS JOIN LATERAL (SELECT d0.dd::date d) d
        JOIN public.service_hours h ON h.service_flag_id=(SELECT id FROM public.service_flags WHERE service_key='clean' LIMIT 1)
             AND h.weekday=extract(dow from d.d)::int AND NOT coalesce(h.is_closed,false)
        CROSS JOIN LATERAL generate_series((extract(epoch from h.open_time)/60)::int, (extract(epoch from h.close_time)/60)::int-30, 30) sl(m)) q;
    _svc := _svc || jsonb_build_object(CASE WHEN _g='clean' THEN 'maid' ELSE 'wash' END, jsonb_build_object(
      'completed',_r.completed,'active',_r.active,'cancelled',_r.cancelled,'gmv',_r.gmv,'earning',round(_r.earn,2),'utilisation',_util,
      'notify',(SELECT jsonb_build_object('tried',count(*),'notified',count(notified_at),'converted',count(converted_order_id))
                  FROM public.notify_requests WHERE service_type=_g AND created_at>=_f AND created_at<_t)));
  END LOOP;

  FOREACH _g IN ARRAY ARRAY['store','food'] LOOP
    SELECT count(*) FILTER (WHERE o.status IN ('delivered','completed')) completed,
           count(*) FILTER (WHERE o.status NOT IN ('delivered','completed','cancelled','rejected')) active,
           count(*) FILTER (WHERE o.status IN ('cancelled','rejected')) cancelled,
           coalesce(sum(coalesce(o.total_payable,o.total_amount)) FILTER (WHERE o.status IN ('delivered','completed')),0) gmv,
           coalesce(sum(coalesce(o.commission_amount,0)+greatest(coalesce(o.delivery_fee,0)-coalesce(o.rider_share_amount,0),0)+coalesce(o.platform_fee,0))
             FILTER (WHERE o.status IN ('delivered','completed')),0) earn
      INTO _r FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g
       AND o.created_at>=_f AND o.created_at<_t
       AND (coalesce(o.payment_mode,'')<>'online' OR o.payment_status<>'pending');
    _svc := _svc || jsonb_build_object(_g, jsonb_build_object(
      'completed',_r.completed,'active',_r.active,'cancelled',_r.cancelled,'gmv',_r.gmv,'earning',round(_r.earn,2),
      'utilisation', CASE WHEN coalesce((_riders->>'online')::int,0)>0 THEN round((_riders->>'busy')::numeric*100/(_riders->>'online')::numeric,0) END,
      'notify',(SELECT jsonb_build_object('tried',count(*),'notified',count(notified_at),'converted',count(converted_order_id))
                  FROM public.notify_requests WHERE service_type=_g AND created_at>=_f AND created_at<_t)));
  END LOOP;

  SELECT count(*) FILTER (WHERE status IN ('DELIVERED','COMPLETED')) completed,
         count(*) FILTER (WHERE status NOT IN ('DELIVERED','COMPLETED','CANCELLED','FAILED','EXPIRED')) active,
         count(*) FILTER (WHERE status IN ('CANCELLED','FAILED','EXPIRED')) cancelled,
         coalesce(sum(total_amount) FILTER (WHERE status IN ('DELIVERED','COMPLETED')),0) gmv,
         coalesce(sum((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))
                      - round((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))*(100-coalesce(commission_pct,0))/100,2)
                      + coalesce(platform_fee,0))
           FILTER (WHERE status IN ('DELIVERED','COMPLETED')),0) earn
    INTO _r FROM public.courier_orders WHERE merchant_order_id IS NULL AND created_at>=_f AND created_at<_t;
  _svc := _svc || jsonb_build_object('parcel', jsonb_build_object(
    'completed',_r.completed,'active',_r.active,'cancelled',_r.cancelled,'gmv',_r.gmv,'earning',round(_r.earn,2),
    'utilisation', CASE WHEN coalesce((_riders->>'online')::int,0)>0 THEN round((_riders->>'busy')::numeric*100/(_riders->>'online')::numeric,0) END,
    'notify',(SELECT jsonb_build_object('tried',count(*),'notified',count(notified_at),'converted',count(converted_order_id))
                FROM public.notify_requests WHERE service_type='parcel' AND created_at>=_f AND created_at<_t)));

  SELECT coalesce(jsonb_agg(row_to_json(d) ORDER BY d.day),'[]'::jsonb) INTO _daily FROM (
    SELECT g.day::date AS day,
      (SELECT count(*) FROM public.bookings b WHERE coalesce(b.is_training,false)=false AND b.scheduled_date=g.day::date AND public.booking_capacity_group(b.service_category_id,b.service_label)='clean') maid,
      (SELECT count(*) FROM public.bookings b WHERE coalesce(b.is_training,false)=false AND b.scheduled_date=g.day::date AND public.booking_capacity_group(b.service_category_id,b.service_label)='wash') wash,
      (SELECT count(*) FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id WHERE m.service_type<>'food' AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date=g.day::date AND (coalesce(o.payment_mode,'')<>'online' OR o.payment_status<>'pending')) store,
      (SELECT count(*) FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id WHERE m.service_type='food' AND (o.created_at AT TIME ZONE 'Asia/Kolkata')::date=g.day::date AND (coalesce(o.payment_mode,'')<>'online' OR o.payment_status<>'pending')) food,
      (SELECT count(*) FROM public.courier_orders c WHERE c.merchant_order_id IS NULL AND (c.created_at AT TIME ZONE 'Asia/Kolkata')::date=g.day::date) parcel
    FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(day)) d;

  _alerts := jsonb_build_object(
    'pending_products_store', (SELECT count(*) FROM public.products p JOIN public.merchants m ON m.id=p.merchant_id WHERE p.approval_status='pending' AND m.service_type<>'food'),
    'pending_products_food', (SELECT count(*) FROM public.products p JOIN public.merchants m ON m.id=p.merchant_id WHERE p.approval_status='pending' AND m.service_type='food'),
    'instant_to_pay', (SELECT count(*) FROM public.merchant_settlements WHERE type='instant' AND status='approved'),
    'refunds_failed', (SELECT count(*) FROM public.merchant_orders WHERE refund_status='failed'),
    'carry_forward_merchants', (SELECT count(DISTINCT store_id) FROM public.merchant_settlements WHERE status='carry_forward'),
    'all_riders_busy', coalesce((_riders->>'online')::int,0) > 0 AND coalesce((_riders->>'free')::int,0) = 0,
    'riders', _riders);
  RETURN jsonb_build_object('services',_svc,'daily',_daily,'alerts',_alerts);
END $$;

CREATE OR REPLACE FUNCTION public.staff_tax_report(_month date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _f timestamptz := (date_trunc('month',_month)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((date_trunc('month',_month)+interval '1 month')::timestamp AT TIME ZONE 'Asia/Kolkata');
        _sum jsonb; _merch jsonb; _rsum jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  WITH o AS (
    SELECT o.*, m.service_type svc,
      coalesce((o.tax_rates_snapshot->>'order_delivery_gst')::numeric,(o.tax_rates_snapshot->>'delivery_gst')::numeric) del_rate
    FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
    WHERE o.paid_at IS NOT NULL AND o.paid_at>=_f AND o.paid_at<_t AND coalesce(o.is_training,false)=false)
  SELECT jsonb_build_object(
    'orders', count(*),
    'food_gst_9_5', coalesce(sum(gst_items) FILTER (WHERE svc='food'),0),
    'store_delivery_gst', coalesce(sum(gst_delivery) FILTER (WHERE svc<>'food'),0),
    'food_delivery_gst', coalesce(sum(gst_delivery) FILTER (WHERE svc='food'),0),
    'commission_gst', coalesce(sum(coalesce(commission_gst,commission_gst_amount,0)),0),
    'platform_fee_gst', coalesce(sum(gst_platform),0),
    'tcs', coalesce(sum(tcs_amount),0), 'tds', coalesce(sum(tds_amount),0),
    'delivery_gst_rates', coalesce(jsonb_agg(DISTINCT del_rate) FILTER (WHERE del_rate IS NOT NULL),'[]'::jsonb)) INTO _sum FROM o;
  _sum := _sum || jsonb_build_object('parcel_delivery_gst',
    (SELECT coalesce(sum(gst_amount),0) FROM public.courier_orders WHERE merchant_order_id IS NULL AND payment_status='paid'
       AND created_at>=_f AND created_at<_t));
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'),'[]'::jsonb) INTO _merch FROM (
    SELECT jsonb_build_object('merchant_id',m.id,'name',m.store_name,'service',m.service_type,'gstin',m.gstin,'pan',m.pan,
      'orders',count(*),'taxable_value',sum(coalesce(o.item_total,o.items_total,0)),'tcs',sum(o.tcs_amount),'tds',sum(o.tds_amount),
      'commission',sum(o.commission_amount),'commission_gst',sum(coalesce(o.commission_gst,0))) x
    FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
    WHERE o.paid_at IS NOT NULL AND o.paid_at>=_f AND o.paid_at<_t AND coalesce(o.is_training,false)=false
    GROUP BY m.id) s;

  WITH r AS (
    SELECT o.*, m.service_type svc, m.store_name, m.gstin m_gstin, m.pan m_pan,
      CASE WHEN coalesce(o.total_payable,o.total_amount,0)>0
           THEN LEAST(1, coalesce(o.refund_amount, coalesce(o.total_payable,o.total_amount))/coalesce(o.total_payable,o.total_amount)) ELSE 1 END ratio
    FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
    WHERE o.refund_status='done' AND coalesce(o.refunded_at,o.updated_at)>=_f AND coalesce(o.refunded_at,o.updated_at)<_t
      AND coalesce(o.is_training,false)=false)
  SELECT jsonb_build_object(
    'refunds', count(*),
    'refund_amount', -coalesce(sum(coalesce(refund_amount,total_payable,total_amount)),0),
    'food_gst_9_5', -coalesce(round(sum(gst_items*ratio) FILTER (WHERE svc='food'),2),0),
    'store_delivery_gst', -coalesce(round(sum(gst_delivery*ratio) FILTER (WHERE svc<>'food'),2),0),
    'food_delivery_gst', -coalesce(round(sum(gst_delivery*ratio) FILTER (WHERE svc='food'),2),0),
    'commission_gst', -coalesce(round(sum(coalesce(commission_gst,commission_gst_amount,0)*ratio),2),0),
    'platform_fee_gst', -coalesce(round(sum(gst_platform*ratio),2),0),
    'tcs', -coalesce(round(sum(tcs_amount*ratio),2),0), 'tds', -coalesce(round(sum(tds_amount*ratio),2),0),
    'lines', coalesce(jsonb_agg(jsonb_build_object('order_number',order_number,'merchant',store_name,'service',svc,
        'gstin',m_gstin,'pan',m_pan,'paid_at',paid_at,'refunded_at',coalesce(refunded_at,updated_at),
        'refund_amount',-coalesce(refund_amount,total_payable,total_amount),
        'taxable_value',-round(coalesce(item_total,items_total,0)*ratio,2),
        'gst_items',-round(coalesce(gst_items,0)*ratio,2),'gst_delivery',-round(coalesce(gst_delivery,0)*ratio,2),
        'gst_platform',-round(coalesce(gst_platform,0)*ratio,2),
        'commission_gst',-round(coalesce(commission_gst,commission_gst_amount,0)*ratio,2),
        'tcs',-round(coalesce(tcs_amount,0)*ratio,2),'tds',-round(coalesce(tds_amount,0)*ratio,2)) ORDER BY coalesce(refunded_at,updated_at)),'[]'::jsonb)
  ) INTO _rsum FROM r;
  _rsum := _rsum || jsonb_build_object('parcel_delivery_gst',
    (SELECT -coalesce(round(sum(gst_amount*CASE WHEN total_amount>0 THEN LEAST(1,coalesce(refund_amount,total_amount)/total_amount) ELSE 1 END),2),0)
       FROM public.courier_orders WHERE merchant_order_id IS NULL AND refund_status='done' AND updated_at>=_f AND updated_at<_t));
  RETURN jsonb_build_object('summary',_sum,'merchants',_merch,'refunds',_rsum);
END $$;

REVOKE ALL ON FUNCTION public.staff_dashboard_overview(date,date) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_tax_report(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_dashboard_overview(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_tax_report(date) TO authenticated;