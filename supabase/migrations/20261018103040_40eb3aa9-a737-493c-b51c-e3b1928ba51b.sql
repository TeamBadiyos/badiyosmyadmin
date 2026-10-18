CREATE TABLE public.spin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, name_mr text,
  city_id uuid REFERENCES public.cities(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  eligibility text NOT NULL DEFAULT 'new_signups' CHECK (eligibility IN ('new_signups','all')),
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.spin_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.spin_events(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  label text NOT NULL, label_mr text,
  color text NOT NULL DEFAULT '#16a34a', icon text,
  prize_type text NOT NULL CHECK (prize_type IN ('physical','percent_coupon','flat_coupon','wallet_bonus')),
  value numeric NOT NULL DEFAULT 0, max_discount numeric, min_order numeric NOT NULL DEFAULT 0,
  valid_days int NOT NULL DEFAULT 30, services text[] NOT NULL DEFAULT '{}',
  stock_limit int CHECK (stock_limit IS NULL OR stock_limit >= 0),
  given int NOT NULL DEFAULT 0 CHECK (given >= 0),
  weight int NOT NULL DEFAULT 1 CHECK (weight >= 0),
  is_fallback boolean NOT NULL DEFAULT false,
  coupon_id uuid REFERENCES public.coupons(id),
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spin_prize_stock_ok CHECK (stock_limit IS NULL OR given <= stock_limit)
);
CREATE INDEX ON public.spin_prizes(event_id);
CREATE TABLE public.spin_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.spin_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, phone text NOT NULL, device_id text NOT NULL, request_id text NOT NULL,
  prize_id uuid NOT NULL REFERENCES public.spin_prizes(id),
  slice_index int NOT NULL, prize_type text NOT NULL,
  redemption_code text, ref_id uuid,
  redeemed_at timestamptz, redeemed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id), UNIQUE (event_id, phone), UNIQUE (event_id, device_id), UNIQUE (request_id)
);
CREATE UNIQUE INDEX ON public.spin_draws(redemption_code) WHERE redemption_code IS NOT NULL;

GRANT SELECT ON public.spin_events, public.spin_prizes, public.spin_draws TO authenticated;
GRANT ALL ON public.spin_events, public.spin_prizes, public.spin_draws TO service_role;
ALTER TABLE public.spin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spin_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spin_draws ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read spin events" ON public.spin_events FOR SELECT TO authenticated USING (public.is_offer_finance_user());
CREATE POLICY "staff read spin prizes" ON public.spin_prizes FOR SELECT TO authenticated USING (public.is_offer_finance_user());
CREATE POLICY "own or staff spin draws" ON public.spin_draws FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_offer_finance_user());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cc_reader') THEN
    EXECUTE 'GRANT SELECT ON public.spin_events, public.spin_prizes, public.spin_draws TO cc_reader';
    EXECUTE 'CREATE POLICY cc_reader_all ON public.spin_events FOR SELECT TO cc_reader USING (true)';
    EXECUTE 'CREATE POLICY cc_reader_all ON public.spin_prizes FOR SELECT TO cc_reader USING (true)';
    EXECUTE 'CREATE POLICY cc_reader_all ON public.spin_draws FOR SELECT TO cc_reader USING (true)';
  END IF;
END $$;

-- ===== Staff: save event + prizes in one call =====
CREATE OR REPLACE FUNCTION public.staff_spin_save(_event jsonb, _prizes jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; p jsonb; i int := 0; v_pid uuid; v_cid uuid; v_fb int; v_keep uuid[] := '{}';
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF coalesce(trim(_event->>'name'),'') = '' THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF (_event->>'ends_at')::timestamptz <= (_event->>'starts_at')::timestamptz THEN RAISE EXCEPTION 'End must be after start'; END IF;
  IF jsonb_array_length(coalesce(_prizes,'[]')) < 2 THEN RAISE EXCEPTION 'Add at least 2 prizes'; END IF;
  SELECT count(*) INTO v_fb FROM jsonb_array_elements(_prizes) x WHERE (x->>'is_fallback')::boolean;
  IF v_fb <> 1 THEN RAISE EXCEPTION 'Mark exactly one prize as the guaranteed fallback'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_prizes) x WHERE (x->>'is_fallback')::boolean AND nullif(x->>'stock_limit','') IS NOT NULL) THEN
    RAISE EXCEPTION 'The fallback prize must have unlimited stock'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_prizes) x WHERE (x->>'is_fallback')::boolean AND coalesce((x->>'weight')::int,0) <= 0) THEN
    RAISE EXCEPTION 'The fallback prize needs a weight above 0'; END IF;

  v_id := nullif(_event->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO spin_events(name,name_mr,city_id,starts_at,ends_at,eligibility,is_active,created_by)
    VALUES (trim(_event->>'name'), nullif(_event->>'name_mr',''), nullif(_event->>'city_id','')::uuid,
      (_event->>'starts_at')::timestamptz, (_event->>'ends_at')::timestamptz,
      coalesce(_event->>'eligibility','new_signups'), coalesce((_event->>'is_active')::boolean,false), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE spin_events SET name=trim(_event->>'name'), name_mr=nullif(_event->>'name_mr',''),
      city_id=nullif(_event->>'city_id','')::uuid, starts_at=(_event->>'starts_at')::timestamptz,
      ends_at=(_event->>'ends_at')::timestamptz, eligibility=coalesce(_event->>'eligibility','new_signups'),
      is_active=coalesce((_event->>'is_active')::boolean,false), updated_at=now() WHERE id=v_id;
  END IF;

  FOR p IN SELECT * FROM jsonb_array_elements(_prizes) LOOP
    v_pid := nullif(p->>'id','')::uuid;
    IF v_pid IS NULL THEN
      INSERT INTO spin_prizes(event_id,label,prize_type) VALUES (v_id, p->>'label', p->>'prize_type') RETURNING id INTO v_pid;
    END IF;
    UPDATE spin_prizes SET sort_order=i, label=trim(p->>'label'), label_mr=nullif(p->>'label_mr',''),
      color=coalesce(nullif(p->>'color',''),'#16a34a'), icon=nullif(p->>'icon',''),
      prize_type=p->>'prize_type', value=coalesce((p->>'value')::numeric,0),
      max_discount=nullif(p->>'max_discount','')::numeric, min_order=coalesce(nullif(p->>'min_order','')::numeric,0),
      valid_days=coalesce(nullif(p->>'valid_days','')::int,30),
      services=coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'services')),'{}'),
      stock_limit=nullif(p->>'stock_limit','')::int, weight=coalesce((p->>'weight')::int,1),
      is_fallback=coalesce((p->>'is_fallback')::boolean,false), is_deleted=false
    WHERE id=v_pid AND event_id=v_id;
    -- coupon prizes get one backing coupon (not listed, granted per winner)
    IF p->>'prize_type' IN ('percent_coupon','flat_coupon') THEN
      SELECT coupon_id INTO v_cid FROM spin_prizes WHERE id=v_pid;
      IF v_cid IS NULL THEN
        INSERT INTO coupons(code,title,discount_type,discount_value,max_discount,min_order_amount,valid_from,audience,is_active,show_in_list,per_user_limit,created_by)
        VALUES ('SPIN-'||upper(substr(replace(v_pid::text,'-',''),1,8)), trim(p->>'label'),
          CASE WHEN p->>'prize_type'='percent_coupon' THEN 'percent' ELSE 'flat' END,
          coalesce((p->>'value')::numeric,0), nullif(p->>'max_discount','')::numeric, coalesce(nullif(p->>'min_order','')::numeric,0),
          now(),'targeted',true,false,1,auth.uid()) RETURNING id INTO v_cid;
        UPDATE spin_prizes SET coupon_id=v_cid WHERE id=v_pid;
      ELSE
        UPDATE coupons SET title=trim(p->>'label'),
          discount_type=CASE WHEN p->>'prize_type'='percent_coupon' THEN 'percent' ELSE 'flat' END,
          discount_value=coalesce((p->>'value')::numeric,0), max_discount=nullif(p->>'max_discount','')::numeric,
          min_order_amount=coalesce(nullif(p->>'min_order','')::numeric,0), updated_at=now() WHERE id=v_cid;
      END IF;
    END IF;
    v_keep := v_keep || v_pid; i := i + 1;
  END LOOP;
  -- removed prizes: hard delete if never won, else hide
  DELETE FROM spin_prizes sp WHERE sp.event_id=v_id AND NOT sp.id = ANY(v_keep) AND NOT EXISTS (SELECT 1 FROM spin_draws d WHERE d.prize_id=sp.id);
  UPDATE spin_prizes SET is_deleted=true, weight=0 WHERE event_id=v_id AND NOT id = ANY(v_keep);
  INSERT INTO audit_logs(actor_id, action, target_type, target_id, after_state)
  VALUES (auth.uid(), 'spin_event_saved', 'spin_event', v_id, jsonb_build_object('event',_event,'prizes',_prizes));
  RETURN v_id;
END $$;

-- ===== Public: event + wheel =====
CREATE OR REPLACE FUNCTION public.app_spin_event(_city_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
    'event_id', e.id, 'name', e.name, 'name_mr', coalesce(e.name_mr,e.name),
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'eligibility', e.eligibility,
    'slices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'slice_index', s.rn-1, 'prize_id', s.id, 'label', s.label, 'label_mr', coalesce(s.label_mr,s.label),
        'color', s.color, 'icon', s.icon, 'type', s.prize_type,
        'sold_out', s.stock_limit IS NOT NULL AND s.given >= s.stock_limit) ORDER BY s.rn),'[]')
      FROM (SELECT p.*, row_number() OVER (ORDER BY p.sort_order, p.created_at) rn FROM spin_prizes p WHERE p.event_id=e.id AND NOT p.is_deleted) s)
  ) END
  FROM (SELECT * FROM spin_events WHERE is_active AND now() BETWEEN starts_at AND ends_at
        AND (city_id IS NULL OR city_id = _city_id) ORDER BY (city_id IS NULL), starts_at DESC LIMIT 1) e
  RIGHT JOIN (SELECT 1) one ON true;
$$;

CREATE OR REPLACE FUNCTION public.spin_slice_index(_prize uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT rn-1 FROM (SELECT id, row_number() OVER (ORDER BY sort_order, created_at) rn FROM spin_prizes
    WHERE event_id=(SELECT event_id FROM spin_prizes WHERE id=_prize) AND NOT is_deleted) s WHERE id=_prize;
$$;

CREATE OR REPLACE FUNCTION public.spin_draw_json(_d spin_draws)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('prize_id',p.id,'slice_index',_d.slice_index,'label',p.label,'label_mr',coalesce(p.label_mr,p.label),
    'type',p.prize_type,'value',p.value,'redemption_code',_d.redemption_code,'redeemed',_d.redeemed_at IS NOT NULL,'won_at',_d.created_at)
  FROM spin_prizes p WHERE p.id=_d.prize_id;
$$;

CREATE OR REPLACE FUNCTION public.app_spin_status(_event_id uuid, _device_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e spin_events; d spin_draws; u users;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','sign_in'); END IF;
  SELECT * INTO e FROM spin_events WHERE id=_event_id;
  SELECT * INTO d FROM spin_draws WHERE event_id=_event_id AND user_id=auth.uid();
  IF d.id IS NOT NULL THEN RETURN jsonb_build_object('status','already_spun','prize',spin_draw_json(d)); END IF;
  IF e.id IS NULL OR NOT e.is_active OR now() NOT BETWEEN e.starts_at AND e.ends_at THEN RETURN jsonb_build_object('status','not_live'); END IF;
  SELECT * INTO u FROM users WHERE id=auth.uid();
  IF e.eligibility='new_signups' AND (u.created_at IS NULL OR u.created_at < e.starts_at) THEN RETURN jsonb_build_object('status','not_eligible'); END IF;
  IF coalesce(_device_id,'')<>'' AND EXISTS (SELECT 1 FROM spin_draws WHERE event_id=_event_id AND device_id=_device_id) THEN
    RETURN jsonb_build_object('status','device_used'); END IF;
  IF EXISTS (SELECT 1 FROM spin_draws WHERE event_id=_event_id AND phone=right(regexp_replace(coalesce(u.phone,''),'\D','','g'),10)) THEN
    RETURN jsonb_build_object('status','phone_used'); END IF;
  RETURN jsonb_build_object('status','eligible');
END $$;

-- ===== Public: the spin (atomic, idempotent) =====
CREATE OR REPLACE FUNCTION public.app_spin(_event_id uuid, _request_id text, _device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e spin_events; d spin_draws; u users; v_phone text; v_pick uuid; v_total bigint; v_r bigint;
  p spin_prizes; v_code text; v_ref uuid; v_draw uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF coalesce(trim(_request_id),'')='' OR coalesce(trim(_device_id),'')='' THEN RAISE EXCEPTION 'request_id and device_id are required'; END IF;
  -- idempotent retry
  SELECT * INTO d FROM spin_draws WHERE request_id=_request_id;
  IF d.id IS NOT NULL THEN
    IF d.user_id<>auth.uid() THEN RAISE EXCEPTION 'Invalid request'; END IF;
    RETURN jsonb_build_object('ok',true,'prize',spin_draw_json(d));
  END IF;
  SELECT * INTO u FROM users WHERE id=auth.uid();
  v_phone := right(regexp_replace(coalesce(u.phone,''),'\D','','g'),10);
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Phone number missing on account'; END IF;
  -- serialize per customer, phone and device (not per event: spins run in parallel)
  PERFORM pg_advisory_xact_lock(hashtextextended('spin:u:'||_event_id||auth.uid(),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('spin:p:'||_event_id||v_phone,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('spin:d:'||_event_id||_device_id,0));
  SELECT * INTO d FROM spin_draws WHERE event_id=_event_id AND user_id=auth.uid();
  IF d.id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'prize',spin_draw_json(d)); END IF;
  SELECT * INTO e FROM spin_events WHERE id=_event_id;
  IF e.id IS NULL OR NOT e.is_active OR now() NOT BETWEEN e.starts_at AND e.ends_at THEN
    RETURN jsonb_build_object('ok',false,'status','not_live'); END IF;
  IF e.eligibility='new_signups' AND u.created_at < e.starts_at THEN RETURN jsonb_build_object('ok',false,'status','not_eligible'); END IF;
  IF EXISTS (SELECT 1 FROM spin_draws WHERE event_id=_event_id AND device_id=_device_id) THEN RETURN jsonb_build_object('ok',false,'status','device_used'); END IF;
  IF EXISTS (SELECT 1 FROM spin_draws WHERE event_id=_event_id AND phone=v_phone) THEN RETURN jsonb_build_object('ok',false,'status','phone_used'); END IF;

  -- weighted pick among prizes with stock; retry up to 3 times on stock races, then fallback
  FOR attempt IN 1..3 LOOP
    SELECT sum(weight) INTO v_total FROM spin_prizes WHERE event_id=_event_id AND NOT is_deleted AND weight>0
      AND (stock_limit IS NULL OR given < stock_limit);
    EXIT WHEN coalesce(v_total,0)=0;
    v_r := floor(random()*v_total)::bigint;
    SELECT id INTO v_pick FROM (SELECT id, sum(weight) OVER (ORDER BY sort_order, id) cum FROM spin_prizes
      WHERE event_id=_event_id AND NOT is_deleted AND weight>0 AND (stock_limit IS NULL OR given < stock_limit)) s
      WHERE cum > v_r ORDER BY cum LIMIT 1;
    UPDATE spin_prizes SET given=given+1 WHERE id=v_pick AND (stock_limit IS NULL OR given < stock_limit) RETURNING * INTO p;
    EXIT WHEN p.id IS NOT NULL;
  END LOOP;
  IF p.id IS NULL THEN
    UPDATE spin_prizes SET given=given+1 WHERE event_id=_event_id AND is_fallback AND NOT is_deleted RETURNING * INTO p;
    IF p.id IS NULL THEN RAISE EXCEPTION 'No prizes left'; END IF;
  END IF;

  IF p.prize_type='physical' THEN
    LOOP
      v_code := upper(substr(translate(encode(gen_random_bytes(6),'base64'),'+/=0O1IL','XYZ23456'),1,6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM spin_draws WHERE redemption_code=v_code);
    END LOOP;
  ELSIF p.prize_type IN ('percent_coupon','flat_coupon') THEN
    INSERT INTO customer_coupons(user_id,coupon_id,source,source_ref,status,expires_at)
    VALUES (auth.uid(),p.coupon_id,'spin_win',v_draw::text,'available',now()+make_interval(days=>p.valid_days)) RETURNING id INTO v_ref;
  ELSIF p.prize_type='wallet_bonus' AND p.value>0 THEN
    PERFORM wallet_post(auth.uid(),'bonus','bonus',p.value,'spin_win',v_draw::text,'Spin & Win: '||p.label,
      now()+make_interval(days=>30),NULL);
  END IF;

  INSERT INTO spin_draws(id,event_id,user_id,phone,device_id,request_id,prize_id,slice_index,prize_type,redemption_code,ref_id)
  VALUES (v_draw,_event_id,auth.uid(),v_phone,_device_id,_request_id,p.id,spin_slice_index(p.id),p.prize_type,v_code,v_ref)
  RETURNING * INTO d;
  RETURN jsonb_build_object('ok',true,'prize',spin_draw_json(d));
END $$;

-- ===== Staff: redeem a physical prize code =====
CREATE OR REPLACE FUNCTION public.staff_spin_redeem(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws;
BEGIN
  IF public.cc_uid() IS NULL AND NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM spin_draws WHERE redemption_code=upper(trim(_code)) FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Code not found'; END IF;
  IF d.redeemed_at IS NOT NULL THEN RAISE EXCEPTION 'Already redeemed at %', to_char(d.redeemed_at AT TIME ZONE 'Asia/Kolkata','DD Mon HH12:MI AM'); END IF;
  UPDATE spin_draws SET redeemed_at=now(), redeemed_by=auth.uid() WHERE id=d.id;
  INSERT INTO audit_logs(actor_id, action, target_type, target_id, after_state)
  VALUES (auth.uid(),'spin_prize_redeemed','spin_draw',d.id,jsonb_build_object('code',d.redemption_code));
  RETURN jsonb_build_object('ok',true,'prize',(SELECT label FROM spin_prizes WHERE id=d.prize_id));
END $$;

-- ===== Staff: event card stats =====
CREATE OR REPLACE FUNCTION public.staff_spin_stats(_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e spin_events;
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO e FROM spin_events WHERE id=_event_id;
  RETURN jsonb_build_object(
    'spins',(SELECT count(*) FROM spin_draws WHERE event_id=_event_id),
    'tickets_redeemed',(SELECT count(*) FROM spin_draws WHERE event_id=_event_id AND redeemed_at IS NOT NULL),
    'tickets_total',(SELECT count(*) FROM spin_draws WHERE event_id=_event_id AND prize_type='physical'),
    'new_signups',(SELECT count(*) FROM users WHERE created_at BETWEEN e.starts_at AND least(e.ends_at,now())),
    'prizes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'type',prize_type,'given',given,'stock_limit',stock_limit) ORDER BY sort_order),'[]')
      FROM spin_prizes WHERE event_id=_event_id AND (NOT is_deleted OR given>0)));
END $$;

CREATE OR REPLACE FUNCTION public.staff_spin_export(_event_id uuid)
RETURNS TABLE(name text, phone text, prize text, prize_type text, won_at timestamptz, redemption_code text, redeemed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY SELECT u.full_name, d.phone, p.label, d.prize_type, d.created_at, d.redemption_code, d.redeemed_at
    FROM spin_draws d JOIN spin_prizes p ON p.id=d.prize_id LEFT JOIN users u ON u.id=d.user_id
    WHERE d.event_id=_event_id ORDER BY d.created_at;
END $$;

REVOKE ALL ON FUNCTION public.app_spin(uuid,text,text), public.app_spin_status(uuid,text), public.staff_spin_save(jsonb,jsonb),
  public.staff_spin_redeem(text), public.staff_spin_stats(uuid), public.staff_spin_export(uuid), public.spin_draw_json(spin_draws),
  public.spin_slice_index(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_spin(uuid,text,text), public.app_spin_status(uuid,text), public.staff_spin_save(jsonb,jsonb),
  public.staff_spin_redeem(text), public.staff_spin_stats(uuid), public.staff_spin_export(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_spin_event(uuid) TO anon, authenticated;