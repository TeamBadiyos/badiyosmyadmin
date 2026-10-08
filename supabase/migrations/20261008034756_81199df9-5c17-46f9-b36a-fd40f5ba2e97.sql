INSERT INTO public.partner_business_lines(key,label,sort_order) VALUES ('auto_care','Auto Care',2);
INSERT INTO public.partner_plan_lines(plan_id,line_key,enabled,pct)
SELECT p.id, 'auto_care', true, COALESCE((SELECT pct FROM public.partner_plan_lines l WHERE l.plan_id=p.id AND l.line_key='car_wash'),0)
  FROM public.partner_commission_plans p;
UPDATE public.partner_payout_lines SET business_line='auto_care' WHERE business_line IN ('car_wash','bike_wash');
DELETE FROM public.partner_plan_lines WHERE line_key IN ('car_wash','bike_wash');
DELETE FROM public.partner_business_lines WHERE key IN ('car_wash','bike_wash');
UPDATE public.partner_business_lines SET label='Delivery', sort_order=3 WHERE key='courier';
UPDATE public.partner_business_lines SET label='Bulk Delivery', sort_order=4 WHERE key='bulk_delivery';
UPDATE public.partner_business_lines SET sort_order=5 WHERE key='store_orders';

CREATE OR REPLACE FUNCTION public.staff_partner_generate_payout(_from date, _to date, _notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _batch uuid; _n int;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Choose a valid start and end date'; END IF;
  IF _to > _today THEN RAISE EXCEPTION 'End date cannot be in the future'; END IF;

  CREATE TEMP TABLE _pp_lines ON COMMIT DROP AS
  WITH ord AS (
    SELECT 'booking'::text otype, b.id oid, COALESCE(b.service_end_at,b.updated_at) done_at, b.service_label svc,
           CASE WHEN sc.name='Auto Care' THEN 'auto_care' ELSE 'home_cleaning' END line,
           GREATEST(COALESCE(b.price,0)-COALESCE(b.discount_amount,0),0) base, b.assigned_expert_id expert_id, b.zone_id, z.city
      FROM public.bookings b
      JOIN public.service_categories sc ON sc.id=b.service_category_id
      JOIN public.segments sg ON sg.id=sc.segment_id
      LEFT JOIN public.zones z ON z.id=b.zone_id
     WHERE b.status='completed' AND NOT COALESCE(b.is_training,false) AND b.deleted_at IS NULL
       AND COALESCE(b.razorpay_payment_id,'') <> ''
       AND COALESCE(b.refund_status,'') <> 'refunded' AND COALESCE(b.refund_amount,0)=0
       AND (sc.name='Auto Care' OR sg.slug='clean')
       AND (COALESCE(b.service_end_at,b.updated_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
    UNION ALL
    SELECT 'courier', c.id, c.completed_at,
           CASE WHEN c.business_merchant_id IS NOT NULL THEN 'Bulk delivery'
                WHEN c.merchant_order_id IS NOT NULL THEN 'Store delivery' ELSE 'Courier delivery' END,
           CASE WHEN c.business_merchant_id IS NOT NULL THEN 'bulk_delivery' ELSE 'courier' END,
           GREATEST(COALESCE(c.base_amount,0)+COALESCE(c.stops_fee,0)-COALESCE(c.discount_amount,0),0),
           c.assigned_expert_id, c.zone_id, COALESCE(zc.city, c.city)
      FROM public.courier_orders c LEFT JOIN public.zones zc ON zc.id=c.zone_id
     WHERE upper(c.status)='COMPLETED' AND c.payment_status='paid' AND c.completed_at IS NOT NULL
       AND COALESCE(c.refund_status,'') <> 'refunded' AND COALESCE(c.refund_amount,0)=0
       AND (c.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
    UNION ALL
    SELECT 'store', mo.id, COALESCE(mo.delivered_at, mo.paid_at), 'Store order', 'store_orders',
           GREATEST(COALESCE(mo.items_total,0),0), NULL::uuid, m.zone_id, m.city
      FROM public.merchant_orders mo JOIN public.merchants m ON m.id=mo.merchant_id
     WHERE lower(mo.status) IN ('delivered','completed') AND lower(COALESCE(mo.payment_status,''))='paid'
       AND NOT COALESCE(mo.is_training,false)
       AND COALESCE(mo.refund_status,'') <> 'refunded' AND COALESCE(mo.refund_amount,0)=0
       AND COALESCE(mo.delivered_at, mo.paid_at) IS NOT NULL
       AND (COALESCE(mo.delivered_at, mo.paid_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
  ), m AS (
    SELECT o.*, p.id partner_id, 'growth'::text program
      FROM ord o JOIN public.experts e ON e.id=o.expert_id
      JOIN public.partners p ON p.id=e.onboarded_by_partner_id AND p.program='growth'
      CROSS JOIN LATERAL public.partner_growth_window(o.expert_id) w
     WHERE o.done_at >= w.win_start AND o.done_at < w.win_end
    UNION ALL
    SELECT o.*, p.id, 'zone_franchise' FROM ord o JOIN public.partners p ON p.program='zone_franchise' AND o.zone_id IS NOT NULL AND p.zone_id=o.zone_id
    UNION ALL
    SELECT o.*, p.id, 'city_master' FROM ord o JOIN public.partners p ON p.program='city_master' AND lower(p.city)=lower(o.city)
  )
  SELECT m.*, pl.id plan_id, pl.name plan_name, ln.pct
    FROM m JOIN public.partners p ON p.id=m.partner_id
    JOIN public.partner_commission_plans pl ON pl.id=p.plan_id
    JOIN public.partner_plan_lines ln ON ln.plan_id=pl.id AND ln.line_key=m.line AND ln.enabled
   WHERE p.status='active'
     AND (m.done_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.agreement_start AND p.agreement_end
     AND m.base > 0 AND ln.pct > 0
     AND public.partner_program_on_at(m.program, m.done_at)
     AND NOT EXISTS (SELECT 1 FROM public.partner_payout_lines l WHERE NOT l.is_deleted
                      AND l.partner_id=m.partner_id AND l.program=m.program AND l.order_type=m.otype AND l.order_id=m.oid);

  SELECT count(*) INTO _n FROM _pp_lines;
  IF _n = 0 THEN RAISE EXCEPTION 'No eligible partner commission in these dates'; END IF;

  INSERT INTO public.partner_payout_batches(period_start, period_end, notes, created_by)
  VALUES (_from, _to, NULLIF(btrim(COALESCE(_notes,'')),''), _uid) RETURNING id INTO _batch;
  INSERT INTO public.partner_payout_items(batch_id, partner_id) SELECT DISTINCT _batch, partner_id FROM _pp_lines;
  INSERT INTO public.partner_payout_lines(batch_id, item_id, partner_id, program, order_type, order_id, order_completed_at,
      service_name, expert_id, base_amount, commission_pct, calculated_amount, amount, plan_id, plan_name, business_line)
  SELECT _batch, i.id, l.partner_id, l.program, l.otype, l.oid, l.done_at, l.svc, l.expert_id, l.base, l.pct,
         round(l.base*l.pct/100.0,2), round(l.base*l.pct/100.0,2), l.plan_id, l.plan_name, l.line
    FROM _pp_lines l JOIN public.partner_payout_items i ON i.batch_id=_batch AND i.partner_id=l.partner_id;
  PERFORM public.partner_recalc_batch(_batch);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_generate','partner_payout_batches',_batch,NULL, jsonb_build_object('from',_from,'to',_to,'lines',_n));
  RETURN _batch;
END $$;