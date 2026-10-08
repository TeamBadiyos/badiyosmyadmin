-- ===== Settings =====
CREATE TABLE public.partner_program_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  master_enabled boolean NOT NULL DEFAULT false,
  growth_enabled boolean NOT NULL DEFAULT false,
  zone_enabled boolean NOT NULL DEFAULT false,
  city_enabled boolean NOT NULL DEFAULT false,
  silver_fee numeric NOT NULL DEFAULT 10000, silver_pct numeric NOT NULL DEFAULT 2,
  gold_fee numeric NOT NULL DEFAULT 25000, gold_pct numeric NOT NULL DEFAULT 3,
  platinum_fee numeric NOT NULL DEFAULT 50000, platinum_pct numeric NOT NULL DEFAULT 5,
  zone_fee numeric NOT NULL DEFAULT 50000, zone_pct numeric NOT NULL DEFAULT 5,
  city_fee numeric NOT NULL DEFAULT 300000, city_pct numeric NOT NULL DEFAULT 2,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.partner_program_settings TO authenticated;
GRANT ALL ON public.partner_program_settings TO service_role;
ALTER TABLE public.partner_program_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner settings" ON public.partner_program_settings FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
INSERT INTO public.partner_program_settings(id) VALUES (1);

CREATE TABLE public.partner_program_toggle_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program text NOT NULL CHECK (program IN ('master','growth','zone_franchise','city_master')),
  enabled boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);
GRANT SELECT ON public.partner_program_toggle_log TO authenticated;
GRANT ALL ON public.partner_program_toggle_log TO service_role;
ALTER TABLE public.partner_program_toggle_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner toggle log" ON public.partner_program_toggle_log FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE INDEX ON public.partner_program_toggle_log(program, changed_at);
INSERT INTO public.partner_program_toggle_log(program, enabled) VALUES
  ('master',false),('growth',false),('zone_franchise',false),('city_master',false);

-- ===== Partners =====
CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  program text NOT NULL CHECK (program IN ('growth','zone_franchise','city_master')),
  level text CHECK (level IN ('silver','gold','platinum')),
  city text NOT NULL,
  zone_id uuid REFERENCES public.zones(id),
  agreement_start date NOT NULL,
  agreement_end date NOT NULL,
  fee_paid numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((program = 'growth') = (level IS NOT NULL)),
  CHECK (program <> 'zone_franchise' OR zone_id IS NOT NULL),
  CHECK (agreement_end >= agreement_start)
);
GRANT SELECT ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partners" ON public.partners FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE UNIQUE INDEX partners_one_zone_franchise ON public.partners(zone_id) WHERE program='zone_franchise' AND status='active';
CREATE UNIQUE INDEX partners_one_city_master ON public.partners(lower(city)) WHERE program='city_master' AND status='active';

ALTER TABLE public.experts ADD COLUMN onboarded_by_partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL;

-- ===== Payouts =====
CREATE TABLE public.partner_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','deleted')),
  total_gross numeric NOT NULL DEFAULT 0,
  total_tds numeric NOT NULL DEFAULT 0,
  total_net numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz, approved_by uuid,
  paid_at timestamptz, paid_on date, paid_reference text, paid_by uuid,
  deleted_at timestamptz, delete_reason text
);
CREATE TABLE public.partner_payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.partner_payout_batches(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  gross_amount numeric NOT NULL DEFAULT 0,
  tds_rate numeric NOT NULL DEFAULT 0,
  tds_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  is_deleted boolean NOT NULL DEFAULT false,
  delete_reason text,
  UNIQUE (batch_id, partner_id)
);
CREATE TABLE public.partner_payout_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.partner_payout_batches(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.partner_payout_items(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  program text NOT NULL CHECK (program IN ('growth','zone_franchise','city_master')),
  order_type text NOT NULL CHECK (order_type IN ('booking','courier')),
  order_id uuid NOT NULL,
  order_completed_at timestamptz NOT NULL,
  service_name text,
  expert_id uuid,
  base_amount numeric NOT NULL,
  commission_pct numeric NOT NULL,
  calculated_amount numeric NOT NULL,
  amount numeric NOT NULL,
  edit_reason text,
  is_deleted boolean NOT NULL DEFAULT false,
  delete_reason text
);
CREATE UNIQUE INDEX partner_payout_lines_once ON public.partner_payout_lines(partner_id, program, order_type, order_id) WHERE NOT is_deleted;
CREATE INDEX ON public.partner_payout_lines(item_id);
GRANT SELECT ON public.partner_payout_batches, public.partner_payout_items, public.partner_payout_lines TO authenticated;
GRANT ALL ON public.partner_payout_batches, public.partner_payout_items, public.partner_payout_lines TO service_role;
ALTER TABLE public.partner_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_payout_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read partner batches" ON public.partner_payout_batches FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff read partner items" ON public.partner_payout_items FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));
CREATE POLICY "Staff read partner lines" ON public.partner_payout_lines FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

-- ===== Helpers =====
CREATE OR REPLACE FUNCTION public.partner_require_admin() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden: Super Admin only'; END IF;
  RETURN auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.partner_program_on_at(_program text, _at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT enabled FROM public.partner_program_toggle_log WHERE program='master' AND changed_at <= _at ORDER BY changed_at DESC LIMIT 1), false)
     AND COALESCE((SELECT enabled FROM public.partner_program_toggle_log WHERE program=_program AND changed_at <= _at ORDER BY changed_at DESC LIMIT 1), false)
$$;

-- Growth window: 12 months from first completed order, ended early by first 30+ day gap
CREATE OR REPLACE FUNCTION public.partner_growth_window(_expert_id uuid)
RETURNS TABLE(win_start timestamptz, win_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH d AS (
    SELECT COALESCE(b.service_end_at, b.updated_at) AS done_at FROM public.bookings b
     WHERE b.assigned_expert_id=_expert_id AND b.status='completed' AND NOT COALESCE(b.is_training,false) AND b.deleted_at IS NULL
    UNION ALL
    SELECT c.completed_at FROM public.courier_orders c
     WHERE c.assigned_expert_id=_expert_id AND upper(c.status)='COMPLETED' AND c.completed_at IS NOT NULL
  ), g AS (SELECT done_at, lag(done_at) OVER (ORDER BY done_at) AS prev FROM d)
  SELECT min(done_at),
         LEAST(min(done_at) + interval '12 months',
               COALESCE(min(prev + interval '30 days') FILTER (WHERE done_at - prev > interval '30 days'), 'infinity'::timestamptz))
    FROM g HAVING count(*) > 0
$$;

CREATE OR REPLACE FUNCTION public.partner_recalc_batch(_batch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _rate numeric := 0;
BEGIN
  IF public.get_ops_flag('tds_master_enabled') THEN _rate := public.get_ops_num('tds_default_rate', 2); END IF;
  UPDATE public.partner_payout_items i SET
    gross_amount = s.g,
    tds_rate = _rate,
    tds_amount = round(s.g * _rate / 100.0),
    net_amount = s.g - round(s.g * _rate / 100.0)
  FROM (SELECT i2.id, COALESCE((SELECT sum(l.amount) FROM public.partner_payout_lines l WHERE l.item_id=i2.id AND NOT l.is_deleted),0) g
          FROM public.partner_payout_items i2 WHERE i2.batch_id=_batch_id) s
  WHERE i.id = s.id;
  UPDATE public.partner_payout_batches b SET
    total_gross = COALESCE((SELECT sum(gross_amount) FROM public.partner_payout_items WHERE batch_id=_batch_id AND NOT is_deleted),0),
    total_tds = COALESCE((SELECT sum(tds_amount) FROM public.partner_payout_items WHERE batch_id=_batch_id AND NOT is_deleted),0),
    total_net = COALESCE((SELECT sum(net_amount) FROM public.partner_payout_items WHERE batch_id=_batch_id AND NOT is_deleted),0)
  WHERE b.id=_batch_id;
END $$;

-- ===== Admin writes =====
CREATE OR REPLACE FUNCTION public.staff_partner_update_settings(_p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _before jsonb; _after jsonb; k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['silver_fee','silver_pct','gold_fee','gold_pct','platinum_fee','platinum_pct','zone_fee','zone_pct','city_fee','city_pct'] LOOP
    IF _p ? k AND ((_p->>k)::numeric < 0 OR (k LIKE '%pct' AND (_p->>k)::numeric > 100)) THEN RAISE EXCEPTION 'Invalid value for %', k; END IF;
  END LOOP;
  SELECT to_jsonb(s) INTO _before FROM public.partner_program_settings s WHERE id=1;
  UPDATE public.partner_program_settings SET
    silver_fee=COALESCE((_p->>'silver_fee')::numeric,silver_fee), silver_pct=COALESCE((_p->>'silver_pct')::numeric,silver_pct),
    gold_fee=COALESCE((_p->>'gold_fee')::numeric,gold_fee), gold_pct=COALESCE((_p->>'gold_pct')::numeric,gold_pct),
    platinum_fee=COALESCE((_p->>'platinum_fee')::numeric,platinum_fee), platinum_pct=COALESCE((_p->>'platinum_pct')::numeric,platinum_pct),
    zone_fee=COALESCE((_p->>'zone_fee')::numeric,zone_fee), zone_pct=COALESCE((_p->>'zone_pct')::numeric,zone_pct),
    city_fee=COALESCE((_p->>'city_fee')::numeric,city_fee), city_pct=COALESCE((_p->>'city_pct')::numeric,city_pct),
    updated_at=now(), updated_by=_uid WHERE id=1;
  SELECT to_jsonb(s) INTO _after FROM public.partner_program_settings s WHERE id=1;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_settings_update','partner_program_settings',NULL,_before,_after);
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_toggle(_program text, _enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _col text; _cur boolean;
BEGIN
  _col := CASE _program WHEN 'master' THEN 'master_enabled' WHEN 'growth' THEN 'growth_enabled'
            WHEN 'zone_franchise' THEN 'zone_enabled' WHEN 'city_master' THEN 'city_enabled' END;
  IF _col IS NULL THEN RAISE EXCEPTION 'Invalid program'; END IF;
  EXECUTE format('SELECT %I FROM public.partner_program_settings WHERE id=1', _col) INTO _cur;
  IF _cur = _enabled THEN RETURN; END IF;
  EXECUTE format('UPDATE public.partner_program_settings SET %I=$1, updated_at=now(), updated_by=$2 WHERE id=1', _col) USING _enabled, _uid;
  INSERT INTO public.partner_program_toggle_log(program, enabled, changed_by) VALUES (_program, _enabled, _uid);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_program_toggle','partner_program_settings',NULL,
          jsonb_build_object('program',_program,'enabled',_cur), jsonb_build_object('program',_program,'enabled',_enabled));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_upsert(_p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _id uuid := NULLIF(_p->>'id','')::uuid;
  _program text := _p->>'program'; _level text := NULLIF(_p->>'level','');
  _zone uuid := NULLIF(_p->>'zone_id','')::uuid; _city text := btrim(COALESCE(_p->>'city',''));
  _start date := (_p->>'agreement_start')::date; _end date := COALESCE(NULLIF(_p->>'agreement_end','')::date, ((_p->>'agreement_start')::date + interval '1 year' - interval '1 day')::date);
  _status text := COALESCE(NULLIF(_p->>'status',''),'active'); _before jsonb; _after jsonb;
BEGIN
  IF btrim(COALESCE(_p->>'name','')) = '' OR btrim(COALESCE(_p->>'phone','')) = '' THEN RAISE EXCEPTION 'Name and phone are required'; END IF;
  IF _program NOT IN ('growth','zone_franchise','city_master') THEN RAISE EXCEPTION 'Invalid program'; END IF;
  IF _program = 'growth' AND _level IS NULL THEN RAISE EXCEPTION 'Level is required for Growth Partner'; END IF;
  IF _program <> 'growth' THEN _level := NULL; END IF;
  IF _program = 'zone_franchise' THEN
    IF _zone IS NULL THEN RAISE EXCEPTION 'Zone is required for Zone Franchise'; END IF;
    SELECT city INTO _city FROM public.zones WHERE id=_zone AND deleted_at IS NULL;
    IF _city IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  ELSE _zone := NULL; END IF;
  IF _city = '' THEN RAISE EXCEPTION 'City is required'; END IF;
  IF _start IS NULL THEN RAISE EXCEPTION 'Agreement start date is required'; END IF;
  IF _status = 'active' AND _program='zone_franchise' AND EXISTS (SELECT 1 FROM public.partners WHERE program='zone_franchise' AND status='active' AND zone_id=_zone AND id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'This zone already has an active Zone Franchise'; END IF;
  IF _status = 'active' AND _program='city_master' AND EXISTS (SELECT 1 FROM public.partners WHERE program='city_master' AND status='active' AND lower(city)=lower(_city) AND id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'This city already has an active City Master'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.partners(name, phone, program, level, city, zone_id, agreement_start, agreement_end, fee_paid, status, notes)
    VALUES (btrim(_p->>'name'), btrim(_p->>'phone'), _program, _level, _city, _zone, _start, _end,
            COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0), _status, NULLIF(_p->>'notes',''))
    RETURNING id INTO _id;
  ELSE
    SELECT to_jsonb(p) INTO _before FROM public.partners p WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;
    UPDATE public.partners SET name=btrim(_p->>'name'), phone=btrim(_p->>'phone'), program=_program, level=_level, city=_city,
      zone_id=_zone, agreement_start=_start, agreement_end=_end, fee_paid=COALESCE(NULLIF(_p->>'fee_paid','')::numeric,0),
      status=_status, notes=NULLIF(_p->>'notes',''), updated_at=now() WHERE id=_id;
  END IF;
  SELECT to_jsonb(p) INTO _after FROM public.partners p WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _before IS NULL THEN 'partner_create' ELSE 'partner_update' END, 'partners', _id, _before, _after);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_set_expert_growth_partner(_expert_id uuid, _partner_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _old uuid;
BEGIN
  SELECT onboarded_by_partner_id INTO _old FROM public.experts WHERE id=_expert_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expert not found'; END IF;
  IF _partner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.partners WHERE id=_partner_id AND program='growth') THEN
    RAISE EXCEPTION 'Choose a Growth Partner'; END IF;
  UPDATE public.experts SET onboarded_by_partner_id=_partner_id WHERE id=_expert_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'expert_growth_partner_set','experts',_expert_id, jsonb_build_object('partner_id',_old), jsonb_build_object('partner_id',_partner_id));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_generate_payout(_from date, _to date, _notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _batch uuid; _s record; _n int;
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN RAISE EXCEPTION 'Choose a valid start and end date'; END IF;
  IF _to > _today THEN RAISE EXCEPTION 'End date cannot be in the future'; END IF;
  SELECT * INTO _s FROM public.partner_program_settings WHERE id=1;

  CREATE TEMP TABLE _pp_lines ON COMMIT DROP AS
  WITH ord AS (
    SELECT 'booking'::text otype, b.id oid, COALESCE(b.service_end_at,b.updated_at) done_at, b.service_label svc,
           GREATEST(COALESCE(b.price,0)-COALESCE(b.discount_amount,0),0) base, b.assigned_expert_id expert_id, b.zone_id, z.city
      FROM public.bookings b
      JOIN public.service_categories sc ON sc.id=b.service_category_id
      LEFT JOIN public.zones z ON z.id=b.zone_id
     WHERE b.status='completed' AND NOT COALESCE(b.is_training,false) AND b.deleted_at IS NULL
       AND COALESCE(b.razorpay_payment_id,'') <> ''
       AND COALESCE(b.refund_status,'') <> 'refunded' AND COALESCE(b.refund_amount,0) = 0
       AND sc.slug IN ('home-cleaning','festival-special-cleaning','car-bike-wash')
       AND (COALESCE(b.service_end_at,b.updated_at) AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
    UNION ALL
    SELECT 'courier', c.id, c.completed_at, 'Courier delivery',
           GREATEST(COALESCE(c.base_amount,0)+COALESCE(c.stops_fee,0)-COALESCE(c.discount_amount,0),0), c.assigned_expert_id, NULL::uuid, c.city
      FROM public.courier_orders c
     WHERE upper(c.status)='COMPLETED' AND c.payment_status='paid' AND c.completed_at IS NOT NULL
       AND c.merchant_order_id IS NULL AND c.business_merchant_id IS NULL
       AND COALESCE(c.refund_status,'') <> 'refunded' AND COALESCE(c.refund_amount,0) = 0
       AND (c.completed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN _from AND _to
  ), m AS (
    SELECT o.*, p.id partner_id, 'growth'::text program,
           CASE p.level WHEN 'silver' THEN _s.silver_pct WHEN 'gold' THEN _s.gold_pct ELSE _s.platinum_pct END pct
      FROM ord o JOIN public.experts e ON e.id=o.expert_id
      JOIN public.partners p ON p.id=e.onboarded_by_partner_id AND p.program='growth'
      CROSS JOIN LATERAL public.partner_growth_window(o.expert_id) w
     WHERE o.done_at >= w.win_start AND o.done_at < w.win_end
    UNION ALL
    SELECT o.*, p.id, 'zone_franchise', _s.zone_pct
      FROM ord o JOIN public.partners p ON p.program='zone_franchise' AND p.zone_id=o.zone_id
    UNION ALL
    SELECT o.*, p.id, 'city_master', _s.city_pct
      FROM ord o JOIN public.partners p ON p.program='city_master' AND lower(p.city)=lower(o.city)
  )
  SELECT m.* FROM m JOIN public.partners p ON p.id=m.partner_id
   WHERE p.status='active'
     AND (m.done_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN p.agreement_start AND p.agreement_end
     AND m.base > 0 AND m.pct > 0
     AND public.partner_program_on_at(m.program, m.done_at)
     AND NOT EXISTS (SELECT 1 FROM public.partner_payout_lines l WHERE NOT l.is_deleted
                      AND l.partner_id=m.partner_id AND l.program=m.program AND l.order_type=m.otype AND l.order_id=m.oid);

  SELECT count(*) INTO _n FROM _pp_lines;
  IF _n = 0 THEN RAISE EXCEPTION 'No eligible partner commission in these dates'; END IF;

  INSERT INTO public.partner_payout_batches(period_start, period_end, notes, created_by)
  VALUES (_from, _to, NULLIF(btrim(COALESCE(_notes,'')),''), _uid) RETURNING id INTO _batch;
  INSERT INTO public.partner_payout_items(batch_id, partner_id) SELECT DISTINCT _batch, partner_id FROM _pp_lines;
  INSERT INTO public.partner_payout_lines(batch_id, item_id, partner_id, program, order_type, order_id, order_completed_at,
      service_name, expert_id, base_amount, commission_pct, calculated_amount, amount)
  SELECT _batch, i.id, l.partner_id, l.program, l.otype, l.oid, l.done_at, l.svc, l.expert_id, l.base, l.pct,
         round(l.base * l.pct / 100.0, 2), round(l.base * l.pct / 100.0, 2)
    FROM _pp_lines l JOIN public.partner_payout_items i ON i.batch_id=_batch AND i.partner_id=l.partner_id;
  PERFORM public.partner_recalc_batch(_batch);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_generate','partner_payout_batches',_batch,NULL,
          jsonb_build_object('from',_from,'to',_to,'lines',_n));
  RETURN _batch;
END $$;

CREATE OR REPLACE FUNCTION public.partner_assert_draft(_batch_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _st text;
BEGIN
  SELECT status INTO _st FROM public.partner_payout_batches WHERE id=_batch_id;
  IF _st IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
  IF _st <> 'draft' THEN RAISE EXCEPTION 'Only draft batches can be changed'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_line_edit(_line_id uuid, _amount numeric, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _l record;
BEGIN
  IF btrim(COALESCE(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'Amount must be 0 or more'; END IF;
  SELECT * INTO _l FROM public.partner_payout_lines WHERE id=_line_id;
  IF _l.id IS NULL OR _l.is_deleted THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public.partner_assert_draft(_l.batch_id);
  UPDATE public.partner_payout_lines SET amount=round(_amount,2), edit_reason=btrim(_reason) WHERE id=_line_id;
  PERFORM public.partner_recalc_batch(_l.batch_id);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_line_edit','partner_payout_lines',_line_id, jsonb_build_object('amount',_l.amount),
          jsonb_build_object('amount',round(_amount,2),'reason',btrim(_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_line_delete(_line_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _l record;
BEGIN
  IF btrim(COALESCE(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO _l FROM public.partner_payout_lines WHERE id=_line_id;
  IF _l.id IS NULL OR _l.is_deleted THEN RAISE EXCEPTION 'Line not found'; END IF;
  PERFORM public.partner_assert_draft(_l.batch_id);
  UPDATE public.partner_payout_lines SET is_deleted=true, delete_reason=btrim(_reason) WHERE id=_line_id;
  UPDATE public.partner_payout_items SET is_deleted=true, delete_reason='All lines removed'
   WHERE id=_l.item_id AND NOT EXISTS (SELECT 1 FROM public.partner_payout_lines WHERE item_id=_l.item_id AND NOT is_deleted);
  PERFORM public.partner_recalc_batch(_l.batch_id);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_line_delete','partner_payout_lines',_line_id, to_jsonb(_l), jsonb_build_object('reason',btrim(_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_item_delete(_item_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _i record;
BEGIN
  IF btrim(COALESCE(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO _i FROM public.partner_payout_items WHERE id=_item_id;
  IF _i.id IS NULL OR _i.is_deleted THEN RAISE EXCEPTION 'Partner row not found'; END IF;
  PERFORM public.partner_assert_draft(_i.batch_id);
  UPDATE public.partner_payout_lines SET is_deleted=true, delete_reason=btrim(_reason) WHERE item_id=_item_id AND NOT is_deleted;
  UPDATE public.partner_payout_items SET is_deleted=true, delete_reason=btrim(_reason) WHERE id=_item_id;
  PERFORM public.partner_recalc_batch(_i.batch_id);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_item_delete','partner_payout_items',_item_id, to_jsonb(_i), jsonb_build_object('reason',btrim(_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_batch_delete(_batch_id uuid, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin();
BEGIN
  IF btrim(COALESCE(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  PERFORM public.partner_assert_draft(_batch_id);
  UPDATE public.partner_payout_lines SET is_deleted=true, delete_reason=COALESCE(delete_reason, 'Batch deleted: '||btrim(_reason)) WHERE batch_id=_batch_id AND NOT is_deleted;
  UPDATE public.partner_payout_batches SET status='deleted', deleted_at=now(), delete_reason=btrim(_reason) WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_batch_delete','partner_payout_batches',_batch_id, jsonb_build_object('status','draft'),
          jsonb_build_object('status','deleted','reason',btrim(_reason)));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_batch_approve(_batch_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin();
BEGIN
  PERFORM public.partner_assert_draft(_batch_id);
  PERFORM public.partner_recalc_batch(_batch_id);
  UPDATE public.partner_payout_batches SET status='approved', approved_at=now(), approved_by=_uid WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_batch_approve','partner_payout_batches',_batch_id, jsonb_build_object('status','draft'), jsonb_build_object('status','approved'));
END $$;

CREATE OR REPLACE FUNCTION public.staff_partner_batch_mark_paid(_batch_id uuid, _paid_on date, _reference text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := public.partner_require_admin(); _st text;
BEGIN
  SELECT status INTO _st FROM public.partner_payout_batches WHERE id=_batch_id;
  IF _st IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Approve the batch before marking it paid'; END IF;
  IF _paid_on IS NULL THEN RAISE EXCEPTION 'Payment date required'; END IF;
  UPDATE public.partner_payout_batches SET status='paid', paid_at=now(), paid_on=_paid_on,
    paid_reference=NULLIF(btrim(COALESCE(_reference,'')),''), paid_by=_uid WHERE id=_batch_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid,'partner_payout_batch_paid','partner_payout_batches',_batch_id, jsonb_build_object('status','approved'),
          jsonb_build_object('status','paid','paid_on',_paid_on,'reference',_reference));
END $$;

REVOKE ALL ON FUNCTION public.partner_recalc_batch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_growth_window(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_program_on_at(text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_assert_draft(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_require_admin() FROM PUBLIC, anon;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['staff_partner_update_settings(jsonb)','staff_partner_toggle(text,boolean)','staff_partner_upsert(jsonb)',
    'staff_set_expert_growth_partner(uuid,uuid)','staff_partner_generate_payout(date,date,text)','staff_partner_line_edit(uuid,numeric,text)',
    'staff_partner_line_delete(uuid,text)','staff_partner_item_delete(uuid,text)','staff_partner_batch_delete(uuid,text)',
    'staff_partner_batch_approve(uuid)','staff_partner_batch_mark_paid(uuid,date,text)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated, service_role';
  END LOOP;
END $$;