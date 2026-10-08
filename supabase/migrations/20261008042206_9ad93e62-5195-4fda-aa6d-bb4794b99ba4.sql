ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS growth_plan_id uuid REFERENCES public.partner_commission_plans(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.staff_partner_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid;
  _program text := _p->>'program'; _plan uuid := NULLIF(_p->>'plan_id','')::uuid; _plan_row record;
  _gplan uuid := NULLIF(_p->>'growth_plan_id','')::uuid; _gplan_row record;
  _zone uuid := NULLIF(_p->>'zone_id','')::uuid; _city text := btrim(COALESCE(_p->>'city',''));
  _start date := (_p->>'agreement_start')::date;
  _end date := COALESCE(NULLIF(_p->>'agreement_end','')::date, ((_p->>'agreement_start')::date + interval '1 year' - interval '1 day')::date);
  _status text := COALESCE(NULLIF(_p->>'status',''),'active'); _before jsonb; _after jsonb;
BEGIN
  IF btrim(COALESCE(_p->>'name',''))='' OR btrim(COALESCE(_p->>'phone',''))='' THEN RAISE EXCEPTION 'Name and phone are required'; END IF;
  IF _program NOT IN ('growth','zone_franchise','city_master') THEN RAISE EXCEPTION 'Invalid program'; END IF;
  IF _plan IS NULL THEN RAISE EXCEPTION 'Choose a commission plan'; END IF;
  SELECT * INTO _plan_row FROM public.partner_commission_plans WHERE id=_plan;
  IF _plan_row.id IS NULL OR _plan_row.partner_type <> _program THEN RAISE EXCEPTION 'Plan does not match the partner type'; END IF;
  IF _id IS NOT NULL THEN SELECT to_jsonb(p) INTO _before FROM public.partners p WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF; END IF;
  IF _plan_row.status <> 'active' AND (_before IS NULL OR (_before->>'plan_id')::uuid IS DISTINCT FROM _plan) THEN
    RAISE EXCEPTION 'This plan is inactive'; END IF;
  IF _program='growth' THEN _gplan := NULL; END IF;
  IF _gplan IS NOT NULL THEN
    SELECT * INTO _gplan_row FROM public.partner_commission_plans WHERE id=_gplan;
    IF _gplan_row.id IS NULL OR _gplan_row.partner_type <> 'growth' THEN RAISE EXCEPTION 'Growth plan must be a Growth Partner plan'; END IF;
    IF _gplan_row.status <> 'active' AND (_before IS NULL OR NULLIF(_before->>'growth_plan_id','')::uuid IS DISTINCT FROM _gplan) THEN
      RAISE EXCEPTION 'This Growth plan is inactive'; END IF;
  END IF;
  IF _program='zone_franchise' THEN
    IF _zone IS NULL THEN RAISE EXCEPTION 'Zone is required for Zone Franchise'; END IF;
    SELECT city INTO _city FROM public.zones WHERE id=_zone AND deleted_at IS NULL;
    IF _city IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  ELSE _zone := NULL; END IF;
  IF _city='' THEN RAISE EXCEPTION 'City is required'; END IF;
  IF _start IS NULL THEN RAISE EXCEPTION 'Agreement start date is required'; END IF;
  IF _status='active' AND _program='zone_franchise' AND EXISTS (SELECT 1 FROM public.partners WHERE program='zone_franchise' AND status='active' AND zone_id=_zone AND id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'This zone already has an active Zone Franchise'; END IF;
  IF _status='active' AND _program='city_master' AND EXISTS (SELECT 1 FROM public.partners WHERE program='city_master' AND status='active' AND lower(city)=lower(_city) AND id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'This city already has an active City Master'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.partners(name,phone,program,level,plan_id,growth_plan_id,city,zone_id,agreement_start,agreement_end,fee_paid,fee_collected_at,status,notes)
    VALUES (btrim(_p->>'name'),btrim(_p->>'phone'),_program,NULL,_plan,_gplan,_city,_zone,_start,_end,
      COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0), NULLIF(_p->>'fee_collected_at','')::date, _status, NULLIF(_p->>'notes',''))
    RETURNING id INTO _id;
  ELSE
    UPDATE public.partners SET name=btrim(_p->>'name'), phone=btrim(_p->>'phone'), program=_program, level=NULL, plan_id=_plan, growth_plan_id=_gplan,
      city=_city, zone_id=_zone, agreement_start=_start, agreement_end=_end, fee_paid=COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0),
      fee_collected_at=NULLIF(_p->>'fee_collected_at','')::date, status=_status, notes=NULLIF(_p->>'notes',''), updated_at=now()
     WHERE id=_id;
  END IF;
  SELECT to_jsonb(p) INTO _after FROM public.partners p WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'partner_create' ELSE 'partner_update' END, 'partners', _id, _before, _after);
  RETURN _id;
END $$;

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
    SELECT o.*, p.id partner_id, 'growth'::text program,
           CASE WHEN p.program='growth' THEN p.plan_id ELSE p.growth_plan_id END mplan
      FROM ord o JOIN public.experts e ON e.id=o.expert_id
      JOIN public.partners p ON p.id=e.onboarded_by_partner_id
        AND (p.program='growth' OR (p.program IN ('zone_franchise','city_master') AND p.growth_plan_id IS NOT NULL))
      CROSS JOIN LATERAL public.partner_growth_window(o.expert_id) w
     WHERE o.done_at >= w.win_start AND o.done_at < w.win_end
    UNION ALL
    SELECT o.*, p.id, 'zone_franchise', p.plan_id FROM ord o JOIN public.partners p ON p.program='zone_franchise' AND o.zone_id IS NOT NULL AND p.zone_id=o.zone_id
    UNION ALL
    SELECT o.*, p.id, 'city_master', p.plan_id FROM ord o JOIN public.partners p ON p.program='city_master' AND lower(p.city)=lower(o.city)
  )
  SELECT m.*, pl.id plan_id, pl.name plan_name, ln.pct
    FROM m JOIN public.partners p ON p.id=m.partner_id
    JOIN public.partner_commission_plans pl ON pl.id=m.mplan
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