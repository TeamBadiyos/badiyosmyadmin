CREATE TABLE public.spin_prize_tokens (
  id bigserial PRIMARY KEY,
  prize_id uuid NOT NULL REFERENCES public.spin_prizes(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  draw_id uuid,
  claimed_at timestamptz
);
GRANT ALL ON public.spin_prize_tokens TO service_role;
GRANT SELECT ON public.spin_prize_tokens TO cc_reader;
GRANT USAGE ON SEQUENCE public.spin_prize_tokens_id_seq TO service_role;
ALTER TABLE public.spin_prize_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_reader_all ON public.spin_prize_tokens FOR SELECT TO cc_reader USING (true);
CREATE INDEX spin_prize_tokens_free ON public.spin_prize_tokens(prize_id) WHERE draw_id IS NULL;
CREATE INDEX spin_prize_tokens_event ON public.spin_prize_tokens(event_id);

-- keep token pool in step with stock (stock - already given)
CREATE OR REPLACE FUNCTION public.spin_sync_tokens() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_claimed int; v_free int; v_target int;
BEGIN
  SELECT count(*) INTO v_claimed FROM spin_draws WHERE prize_id=NEW.id;
  IF NEW.stock_limit IS NULL OR NEW.is_deleted THEN
    DELETE FROM spin_prize_tokens WHERE prize_id=NEW.id AND draw_id IS NULL; RETURN NEW; END IF;
  IF NEW.stock_limit < v_claimed THEN RAISE EXCEPTION 'Stock for "%" cannot be below % already won', NEW.label, v_claimed; END IF;
  SELECT count(*) INTO v_free FROM spin_prize_tokens WHERE prize_id=NEW.id AND draw_id IS NULL;
  v_target := NEW.stock_limit - v_claimed;
  IF v_free < v_target THEN
    INSERT INTO spin_prize_tokens(prize_id,event_id) SELECT NEW.id, NEW.event_id FROM generate_series(1, v_target - v_free);
  ELSIF v_free > v_target THEN
    DELETE FROM spin_prize_tokens WHERE id IN (SELECT id FROM spin_prize_tokens WHERE prize_id=NEW.id AND draw_id IS NULL
      ORDER BY id DESC LIMIT v_free - v_target FOR UPDATE SKIP LOCKED);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER spin_prizes_sync_tokens AFTER INSERT OR UPDATE OF stock_limit, is_deleted ON public.spin_prizes
  FOR EACH ROW EXECUTE FUNCTION public.spin_sync_tokens();

-- backfill existing prizes
INSERT INTO spin_prize_tokens(prize_id,event_id)
SELECT p.id, p.event_id FROM spin_prizes p
CROSS JOIN LATERAL generate_series(1, greatest(p.stock_limit - (SELECT count(*) FROM spin_draws d WHERE d.prize_id=p.id),0)) g
WHERE p.stock_limit IS NOT NULL AND NOT p.is_deleted;

CREATE OR REPLACE FUNCTION public.spin_prize_given(_prize_id uuid) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT count(*)::int FROM spin_draws WHERE prize_id=_prize_id $$;
REVOKE EXECUTE ON FUNCTION public.spin_prize_given(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.app_spin(_event_id uuid, _request_id text, _device_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e spin_events; d spin_draws; u users; v_phone text; v_pick uuid; v_total bigint; v_r bigint;
  p spin_prizes; v_code text; v_ref uuid; v_draw uuid := gen_random_uuid(); v_tok bigint; v_skip uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF coalesce(trim(_request_id),'')='' OR coalesce(trim(_device_id),'')='' THEN RAISE EXCEPTION 'request_id and device_id are required'; END IF;
  SELECT * INTO d FROM spin_draws WHERE request_id=_request_id;
  IF d.id IS NOT NULL THEN
    IF d.user_id<>auth.uid() THEN RAISE EXCEPTION 'Invalid request'; END IF;
    RETURN jsonb_build_object('ok',true,'prize',spin_draw_json(d));
  END IF;
  SELECT * INTO u FROM users WHERE id=auth.uid();
  v_phone := right(regexp_replace(coalesce(u.phone,''),'\D','','g'),10);
  IF length(v_phone) < 10 THEN RAISE EXCEPTION 'Phone number missing on account'; END IF;
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

  -- weighted pick among unlimited prizes + limited prizes with free tokens; claim token without waiting
  FOR attempt IN 1..4 LOOP
    v_pick := NULL;
    WITH av AS (SELECT sp.id, sp.weight, sp.sort_order FROM spin_prizes sp
      WHERE sp.event_id=_event_id AND NOT sp.is_deleted AND sp.weight>0 AND NOT (sp.id = ANY(v_skip))
        AND (sp.stock_limit IS NULL OR EXISTS (SELECT 1 FROM spin_prize_tokens t WHERE t.prize_id=sp.id AND t.draw_id IS NULL)))
    SELECT sum(weight) INTO v_total FROM av;
    EXIT WHEN coalesce(v_total,0)=0;
    v_r := floor(random()*v_total)::bigint;
    SELECT id INTO v_pick FROM (SELECT sp.id, sum(sp.weight) OVER (ORDER BY sp.sort_order, sp.id) cum FROM spin_prizes sp
      WHERE sp.event_id=_event_id AND NOT sp.is_deleted AND sp.weight>0 AND NOT (sp.id = ANY(v_skip))
        AND (sp.stock_limit IS NULL OR EXISTS (SELECT 1 FROM spin_prize_tokens t WHERE t.prize_id=sp.id AND t.draw_id IS NULL))) s
      WHERE cum > v_r ORDER BY cum LIMIT 1;
    SELECT * INTO p FROM spin_prizes WHERE id=v_pick;
    IF p.stock_limit IS NULL THEN EXIT; END IF;
    UPDATE spin_prize_tokens SET draw_id=v_draw, claimed_at=now()
      WHERE id=(SELECT id FROM spin_prize_tokens WHERE prize_id=p.id AND draw_id IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id INTO v_tok;
    EXIT WHEN v_tok IS NOT NULL;
    v_skip := v_skip || p.id; p := NULL;
  END LOOP;
  IF p.id IS NULL THEN
    SELECT * INTO p FROM spin_prizes WHERE event_id=_event_id AND is_fallback AND NOT is_deleted LIMIT 1;
    IF p.id IS NULL THEN RAISE EXCEPTION 'No prizes left'; END IF;
  END IF;

  IF p.prize_type='physical' THEN
    LOOP
      v_code := upper(substr(translate(upper(md5(random()::text||clock_timestamp()::text)),'0O1I','2345'),1,6));
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
END $function$;

CREATE OR REPLACE FUNCTION public.app_spin_event(_city_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object(
    'event_id', e.id, 'name', e.name, 'name_mr', coalesce(e.name_mr,e.name),
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'eligibility', e.eligibility,
    'slices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'slice_index', s.rn-1, 'prize_id', s.id, 'label', s.label, 'label_mr', coalesce(s.label_mr,s.label),
        'color', s.color, 'icon', s.icon, 'type', s.prize_type,
        'sold_out', s.stock_limit IS NOT NULL AND NOT EXISTS (SELECT 1 FROM spin_prize_tokens t WHERE t.prize_id=s.id AND t.draw_id IS NULL)) ORDER BY s.rn),'[]')
      FROM (SELECT p.*, row_number() OVER (ORDER BY p.sort_order, p.created_at) rn FROM spin_prizes p WHERE p.event_id=e.id AND NOT p.is_deleted) s)
  ) END
  FROM (SELECT * FROM spin_events WHERE is_active AND now() BETWEEN starts_at AND ends_at
        AND (city_id IS NULL OR city_id = _city_id) ORDER BY (city_id IS NULL), starts_at DESC LIMIT 1) e
  RIGHT JOIN (SELECT 1) one ON true;
$function$;

CREATE OR REPLACE FUNCTION public.staff_spin_stats(_event_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e spin_events;
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO e FROM spin_events WHERE id=_event_id;
  RETURN jsonb_build_object(
    'spins',(SELECT count(*) FROM spin_draws WHERE event_id=_event_id),
    'tickets_redeemed',(SELECT count(*) FROM spin_draws WHERE event_id=_event_id AND redeemed_at IS NOT NULL),
    'tickets_total',(SELECT count(*) FROM spin_draws WHERE event_id=_event_id AND prize_type='physical'),
    'new_signups',(SELECT count(*) FROM users WHERE created_at BETWEEN e.starts_at AND least(e.ends_at,now())),
    'prizes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'type',prize_type,'given',g,'stock_limit',stock_limit) ORDER BY sort_order),'[]')
      FROM (SELECT sp.*, spin_prize_given(sp.id) g FROM spin_prizes sp WHERE sp.event_id=_event_id) x WHERE NOT is_deleted OR g>0));
END $function$;

-- keep the legacy `given` column correct off the hot path
CREATE OR REPLACE FUNCTION public.spin_refresh_given(_event_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS
$$ UPDATE spin_prizes sp SET given=spin_prize_given(sp.id) WHERE sp.event_id=_event_id AND sp.given IS DISTINCT FROM spin_prize_given(sp.id) $$;
REVOKE EXECUTE ON FUNCTION public.spin_refresh_given(uuid) FROM anon, authenticated;