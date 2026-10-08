-- Business lines
CREATE TABLE public.partner_business_lines (
  key text PRIMARY KEY,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_business_lines TO authenticated;
GRANT ALL ON public.partner_business_lines TO service_role;
ALTER TABLE public.partner_business_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read business lines" ON public.partner_business_lines FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
INSERT INTO public.partner_business_lines(key,label,sort_order) VALUES
 ('home_cleaning','Home Cleaning',1),('car_wash','Car Wash',2),('bike_wash','Bike Wash',3),
 ('courier','Delivery / Courier',4),('bulk_delivery','Bulk / Business Delivery',5),('store_orders','Store Orders',6);

-- Plans
CREATE TABLE public.partner_commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  partner_type text NOT NULL CHECK (partner_type IN ('growth','zone_franchise','city_master')),
  suggested_fee numeric NOT NULL DEFAULT 0 CHECK (suggested_fee >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.partner_plan_lines (
  plan_id uuid NOT NULL REFERENCES public.partner_commission_plans(id) ON DELETE CASCADE,
  line_key text NOT NULL REFERENCES public.partner_business_lines(key),
  enabled boolean NOT NULL DEFAULT false,
  pct numeric NOT NULL DEFAULT 0 CHECK (pct >= 0 AND pct <= 100),
  PRIMARY KEY (plan_id, line_key)
);
GRANT SELECT ON public.partner_commission_plans, public.partner_plan_lines TO authenticated;
GRANT ALL ON public.partner_commission_plans, public.partner_plan_lines TO service_role;
ALTER TABLE public.partner_commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_plan_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read plans" ON public.partner_commission_plans FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff read plan lines" ON public.partner_plan_lines FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DO $$ DECLARE r record; _id uuid; BEGIN
  FOR r IN SELECT * FROM (VALUES ('Growth Silver','growth',10000,2),('Growth Gold','growth',25000,3),
      ('Growth Platinum','growth',50000,5),('Zone Franchise','zone_franchise',50000,5),('City Master','city_master',300000,2)) v(n,t,f,p) LOOP
    INSERT INTO public.partner_commission_plans(name,partner_type,suggested_fee) VALUES (r.n,r.t,r.f) RETURNING id INTO _id;
    INSERT INTO public.partner_plan_lines(plan_id,line_key,enabled,pct)
    SELECT _id, key, key IN ('home_cleaning','car_wash','bike_wash','courier'),
           CASE WHEN key IN ('home_cleaning','car_wash','bike_wash','courier') THEN r.p ELSE 0 END
      FROM public.partner_business_lines;
  END LOOP;
END $$;

-- Partners
ALTER TABLE public.partners DROP CONSTRAINT partners_check;
ALTER TABLE public.partners ADD COLUMN plan_id uuid REFERENCES public.partner_commission_plans(id),
  ADD COLUMN fee_collected_at date;

-- Payout lines
ALTER TABLE public.partner_payout_lines ADD COLUMN plan_id uuid, ADD COLUMN plan_name text, ADD COLUMN business_line text;
ALTER TABLE public.partner_payout_lines DROP CONSTRAINT partner_payout_lines_order_type_check;
ALTER TABLE public.partner_payout_lines ADD CONSTRAINT partner_payout_lines_order_type_check CHECK (order_type IN ('booking','courier','store'));

-- Courier zone from pickup
ALTER TABLE public.courier_orders ADD COLUMN zone_id uuid REFERENCES public.zones(id);
CREATE OR REPLACE FUNCTION public.courier_orders_set_zone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng THEN
    NEW.zone_id := public.resolve_zone_for_point(NEW.pickup_lat, NEW.pickup_lng);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.courier_orders_set_zone() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER courier_orders_set_zone BEFORE INSERT OR UPDATE OF pickup_lat, pickup_lng ON public.courier_orders
  FOR EACH ROW EXECUTE FUNCTION public.courier_orders_set_zone();
UPDATE public.courier_orders SET zone_id = public.resolve_zone_for_point(pickup_lat, pickup_lng)
 WHERE pickup_lat IS NOT NULL AND zone_id IS DISTINCT FROM public.resolve_zone_for_point(pickup_lat, pickup_lng);

-- Plan writes
CREATE OR REPLACE FUNCTION public.staff_partner_plan_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid; _before jsonb; _after jsonb; _l jsonb;
BEGIN
  IF btrim(COALESCE(_p->>'name',''))='' THEN RAISE EXCEPTION 'Plan name required'; END IF;
  IF _p->>'partner_type' NOT IN ('growth','zone_franchise','city_master') THEN RAISE EXCEPTION 'Invalid partner type'; END IF;
  IF _id IS NOT NULL THEN
    SELECT to_jsonb(c) || jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l)) FROM public.partner_plan_lines l WHERE l.plan_id=c.id))
      INTO _before FROM public.partner_commission_plans c WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
    IF (_before->>'partner_type') <> (_p->>'partner_type') AND EXISTS (SELECT 1 FROM public.partners WHERE plan_id=_id) THEN
      RAISE EXCEPTION 'Partner type cannot change while partners use this plan'; END IF;
    UPDATE public.partner_commission_plans SET name=btrim(_p->>'name'), partner_type=_p->>'partner_type',
      suggested_fee=COALESCE(NULLIF(_p->>'suggested_fee','')::numeric,0), status=COALESCE(NULLIF(_p->>'status',''),'active'), updated_at=now()
     WHERE id=_id;
  ELSE
    INSERT INTO public.partner_commission_plans(name,partner_type,suggested_fee,status)
    VALUES (btrim(_p->>'name'), _p->>'partner_type', COALESCE(NULLIF(_p->>'suggested_fee','')::numeric,0), COALESCE(NULLIF(_p->>'status',''),'active'))
    RETURNING id INTO _id;
  END IF;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(_p->'lines','[]'::jsonb)) LOOP
    IF (_l->>'pct')::numeric < 0 OR (_l->>'pct')::numeric > 100 THEN RAISE EXCEPTION '%% must be between 0 and 100'; END IF;
    INSERT INTO public.partner_plan_lines(plan_id,line_key,enabled,pct)
    VALUES (_id, _l->>'line_key', COALESCE((_l->>'enabled')::boolean,false), COALESCE((_l->>'pct')::numeric,0))
    ON CONFLICT (plan_id,line_key) DO UPDATE SET enabled=EXCLUDED.enabled, pct=EXCLUDED.pct
      WHERE partner_plan_lines.enabled IS DISTINCT FROM EXCLUDED.enabled OR partner_plan_lines.pct IS DISTINCT FROM EXCLUDED.pct;
  END LOOP;
  SELECT to_jsonb(c) || jsonb_build_object('lines',(SELECT jsonb_agg(to_jsonb(l)) FROM public.partner_plan_lines l WHERE l.plan_id=c.id))
    INTO _after FROM public.partner_commission_plans c WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'partner_plan_create' ELSE 'partner_plan_update' END, 'partner_commission_plans', _id, _before, _after);
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.staff_partner_plan_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_partner_plan_upsert(jsonb) TO authenticated, service_role;

-- Partner upsert with plan
CREATE OR REPLACE FUNCTION public.staff_partner_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid;
  _program text := _p->>'program'; _plan uuid := NULLIF(_p->>'plan_id','')::uuid; _plan_row record;
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
    INSERT INTO public.partners(name,phone,program,level,plan_id,city,zone_id,agreement_start,agreement_end,fee_paid,fee_collected_at,status,notes)
    VALUES (btrim(_p->>'name'),btrim(_p->>'phone'),_program,NULL,_plan,_city,_zone,_start,_end,
      COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0), NULLIF(_p->>'fee_collected_at','')::date, _status, NULLIF(_p->>'notes',''))
    RETURNING id INTO _id;
  ELSE
    UPDATE public.partners SET name=btrim(_p->>'name'), phone=btrim(_p->>'phone'), program=_program, level=NULL, plan_id=_plan,
      city=_city, zone_id=_zone, agreement_start=_start, agreement_end=_end, fee_paid=COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0),
      fee_collected_at=NULLIF(_p->>'fee_collected_at','')::date, status=_status, notes=NULLIF(_p->>'notes',''), updated_at=now()
     WHERE id=_id;
  END IF;
  SELECT to_jsonb(p) INTO _after FROM public.partners p WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'partner_create' ELSE 'partner_update' END, 'partners', _id, _before, _after);
  RETURN _id;
END $$;

-- Generator using plans
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
           CASE WHEN sc.slug='car-bike-wash' THEN CASE WHEN b.service_label ILIKE '%bike%' THEN 'bike_wash' ELSE 'car_wash' END ELSE 'home_cleaning' END line,
           GREATEST(COALESCE(b.price,0)-COALESCE(b.discount_amount,0),0) base, b.assigned_expert_id expert_id, b.zone_id, z.city
      FROM public.bookings b
      JOIN public.service_categories sc ON sc.id=b.service_category_id
      LEFT JOIN public.zones z ON z.id=b.zone_id
     WHERE b.status='completed' AND NOT COALESCE(b.is_training,false) AND b.deleted_at IS NULL
       AND COALESCE(b.razorpay_payment_id,'') <> ''
       AND COALESCE(b.refund_status,'') <> 'refunded' AND COALESCE(b.refund_amount,0)=0
       AND sc.slug IN ('home-cleaning','festival-special-cleaning','car-bike-wash')
       AND (COALESCE(b.service_end_at,b.updated_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
    UNION ALL
    SELECT 'courier', c.id, c.completed_at,
           CASE WHEN c.business_merchant_id IS NOT NULL THEN 'Bulk delivery' ELSE 'Courier delivery' END,
           CASE WHEN c.business_merchant_id IS NOT NULL THEN 'bulk_delivery' ELSE 'courier' END,
           GREATEST(COALESCE(c.base_amount,0)+COALESCE(c.stops_fee,0)-COALESCE(c.discount_amount,0),0),
           c.assigned_expert_id, c.zone_id, COALESCE(zc.city, c.city)
      FROM public.courier_orders c LEFT JOIN public.zones zc ON zc.id=c.zone_id
     WHERE upper(c.status)='COMPLETED' AND c.payment_status='paid' AND c.completed_at IS NOT NULL
       AND c.merchant_order_id IS NULL
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