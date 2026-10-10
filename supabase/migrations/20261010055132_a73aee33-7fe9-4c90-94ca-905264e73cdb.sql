
CREATE TABLE public.lucky_draw_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  banner_url text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  enrolment_target integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  show_enrolled_count boolean NOT NULL DEFAULT true,
  show_leaderboard boolean NOT NULL DEFAULT true,
  referral_bonus_enabled boolean NOT NULL DEFAULT true,
  leaderboard_rewards_enabled boolean NOT NULL DEFAULT true,
  leaderboard_top_ranks integer NOT NULL DEFAULT 10,
  winners_published boolean NOT NULL DEFAULT false,
  draw_executed_at timestamptz,
  draw_seed text,
  entry_counter integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lucky_draw_one_active ON public.lucky_draw_campaigns ((true)) WHERE is_active;

CREATE TABLE public.lucky_draw_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.lucky_draw_campaigns(id) ON DELETE CASCADE,
  prize_type text NOT NULL CHECK (prize_type IN ('lucky_draw','leaderboard')),
  name text NOT NULL,
  photo_url text,
  value_inr numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  sort_no integer NOT NULL DEFAULT 0,
  rank_from integer,
  rank_to integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lucky_draw_prizes(campaign_id, prize_type, sort_no);

CREATE TABLE public.lucky_draw_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.lucky_draw_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entry_no text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id),
  UNIQUE (campaign_id, entry_no)
);

CREATE TABLE public.lucky_draw_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.lucky_draw_campaigns(id) ON DELETE CASCADE,
  prize_id uuid REFERENCES public.lucky_draw_prizes(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  prize_type text NOT NULL,
  rank integer,
  entries integer,
  referrals integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.lucky_draw_campaigns, public.lucky_draw_prizes, public.lucky_draw_enrolments, public.lucky_draw_winners TO authenticated;
GRANT ALL ON public.lucky_draw_campaigns, public.lucky_draw_prizes, public.lucky_draw_enrolments, public.lucky_draw_winners TO service_role;
ALTER TABLE public.lucky_draw_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky_draw_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky_draw_enrolments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucky_draw_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY ldc_read ON public.lucky_draw_campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY ldp_read ON public.lucky_draw_prizes FOR SELECT TO authenticated USING (true);
CREATE POLICY lde_read ON public.lucky_draw_enrolments FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin_user());
CREATE POLICY ldw_read ON public.lucky_draw_winners FOR SELECT TO authenticated USING (public.is_super_admin_user() OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.lucky_draw_touch() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER ldc_touch BEFORE UPDATE ON public.lucky_draw_campaigns FOR EACH ROW EXECUTE FUNCTION public.lucky_draw_touch();
CREATE TRIGGER ldp_touch BEFORE UPDATE ON public.lucky_draw_prizes FOR EACH ROW EXECUTE FUNCTION public.lucky_draw_touch();

-- Internal helpers
CREATE OR REPLACE FUNCTION public.lucky_draw_audit(_action text, _id uuid, _before jsonb, _after jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), _action, 'lucky_draw_campaigns', _id, _before, _after);
$$;

CREATE OR REPLACE FUNCTION public.lucky_draw_display_name(_full text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(trim(_full),'') = '' THEN 'Customer'
    ELSE initcap(split_part(trim(_full),' ',1)) ||
      CASE WHEN position(' ' in trim(_full)) > 0
        THEN ' ' || upper(left(trim(regexp_replace(trim(_full), '^\S+\s+', '')),1)) || '.' ELSE '' END END
$$;

-- Standings: referrals counted only from friends who used this customer's code AND enrolled (optionally up to a cutoff)
CREATE OR REPLACE FUNCTION public.lucky_draw_standings(_campaign_id uuid, _cutoff timestamptz DEFAULT NULL)
RETURNS TABLE(user_id uuid, entry_no text, enrolled_at timestamptz, full_name text, phone text, referrals integer, entries integer, rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH c AS (SELECT * FROM lucky_draw_campaigns WHERE id = _campaign_id),
  e AS (SELECT le.* FROM lucky_draw_enrolments le WHERE le.campaign_id = _campaign_id AND (_cutoff IS NULL OR le.enrolled_at <= _cutoff)),
  r AS (
    SELECT e.user_id, count(f.user_id)::int AS refs
    FROM e JOIN users u ON u.id = e.user_id
    LEFT JOIN users fu ON u.referral_code IS NOT NULL AND fu.referred_by = u.referral_code AND fu.id <> u.id
    LEFT JOIN e f ON f.user_id = fu.id
    GROUP BY e.user_id)
  SELECT e.user_id, e.entry_no, e.enrolled_at, u.full_name, u.phone, coalesce(r.refs,0),
    (1 + CASE WHEN (SELECT referral_bonus_enabled FROM c) THEN coalesce(r.refs,0) ELSE 0 END)::int,
    (row_number() OVER (ORDER BY coalesce(r.refs,0) DESC, e.enrolled_at ASC))::int
  FROM e JOIN users u ON u.id = e.user_id LEFT JOIN r ON r.user_id = e.user_id
$$;
REVOKE ALL ON FUNCTION public.lucky_draw_standings(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ===== Super Admin writes =====
CREATE OR REPLACE FUNCTION public.staff_lucky_draw_save_campaign(_id uuid, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _before jsonb; _new uuid; _active boolean := coalesce((_payload->>'is_active')::boolean, false);
BEGIN
  PERFORM staff_require_super_admin();
  IF coalesce(trim(_payload->>'title'),'') = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
  IF (_payload->>'end_at')::timestamptz <= (_payload->>'start_at')::timestamptz THEN RAISE EXCEPTION 'End date must be after start date'; END IF;
  IF _active THEN UPDATE lucky_draw_campaigns SET is_active = false WHERE is_active AND id IS DISTINCT FROM _id; END IF;
  IF _id IS NULL THEN
    INSERT INTO lucky_draw_campaigns(title, description, banner_url, start_at, end_at, enrolment_target, is_active,
      show_enrolled_count, show_leaderboard, referral_bonus_enabled, leaderboard_rewards_enabled, leaderboard_top_ranks, created_by)
    VALUES (_payload->>'title', _payload->>'description', nullif(_payload->>'banner_url',''),
      (_payload->>'start_at')::timestamptz, (_payload->>'end_at')::timestamptz,
      coalesce((_payload->>'enrolment_target')::int,0), _active,
      coalesce((_payload->>'show_enrolled_count')::boolean,true), coalesce((_payload->>'show_leaderboard')::boolean,true),
      coalesce((_payload->>'referral_bonus_enabled')::boolean,true), coalesce((_payload->>'leaderboard_rewards_enabled')::boolean,true),
      coalesce((_payload->>'leaderboard_top_ranks')::int,10), auth.uid())
    RETURNING id INTO _new;
    PERFORM lucky_draw_audit('lucky_draw_campaign_created', _new, NULL, _payload);
    RETURN _new;
  END IF;
  SELECT to_jsonb(c) INTO _before FROM lucky_draw_campaigns c WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  UPDATE lucky_draw_campaigns SET title=_payload->>'title', description=_payload->>'description', banner_url=nullif(_payload->>'banner_url',''),
    start_at=(_payload->>'start_at')::timestamptz, end_at=(_payload->>'end_at')::timestamptz,
    enrolment_target=coalesce((_payload->>'enrolment_target')::int,0), is_active=_active,
    show_enrolled_count=coalesce((_payload->>'show_enrolled_count')::boolean,true), show_leaderboard=coalesce((_payload->>'show_leaderboard')::boolean,true),
    referral_bonus_enabled=coalesce((_payload->>'referral_bonus_enabled')::boolean,true),
    leaderboard_rewards_enabled=coalesce((_payload->>'leaderboard_rewards_enabled')::boolean,true),
    leaderboard_top_ranks=coalesce((_payload->>'leaderboard_top_ranks')::int,10)
  WHERE id = _id;
  PERFORM lucky_draw_audit('lucky_draw_campaign_updated', _id, _before, _payload);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_delete_campaign(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b jsonb;
BEGIN
  PERFORM staff_require_super_admin();
  SELECT to_jsonb(c) INTO _b FROM lucky_draw_campaigns c WHERE id=_id;
  IF EXISTS (SELECT 1 FROM lucky_draw_enrolments WHERE campaign_id=_id) THEN RAISE EXCEPTION 'Campaign has enrolments; set it Inactive instead'; END IF;
  DELETE FROM lucky_draw_campaigns WHERE id=_id;
  PERFORM lucky_draw_audit('lucky_draw_campaign_deleted', _id, _b, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_save_prize(_id uuid, _campaign_id uuid, _payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _new uuid; _type text := _payload->>'prize_type'; _rf int := (_payload->>'rank_from')::int; _rt int := (_payload->>'rank_to')::int;
BEGIN
  PERFORM staff_require_super_admin();
  IF _type NOT IN ('lucky_draw','leaderboard') THEN RAISE EXCEPTION 'Invalid prize type'; END IF;
  IF coalesce(trim(_payload->>'name'),'') = '' THEN RAISE EXCEPTION 'Prize name is required'; END IF;
  IF _type = 'leaderboard' AND (_rf IS NULL OR _rt IS NULL OR _rf < 1 OR _rt < _rf) THEN RAISE EXCEPTION 'Valid rank from / rank to required'; END IF;
  IF _id IS NULL THEN
    INSERT INTO lucky_draw_prizes(campaign_id, prize_type, name, photo_url, value_inr, quantity, sort_no, rank_from, rank_to)
    VALUES (_campaign_id, _type, _payload->>'name', nullif(_payload->>'photo_url',''), coalesce((_payload->>'value_inr')::numeric,0),
      CASE WHEN _type='leaderboard' THEN _rt-_rf+1 ELSE greatest(coalesce((_payload->>'quantity')::int,1),1) END,
      coalesce((_payload->>'sort_no')::int,0), CASE WHEN _type='leaderboard' THEN _rf END, CASE WHEN _type='leaderboard' THEN _rt END)
    RETURNING id INTO _new;
  ELSE
    UPDATE lucky_draw_prizes SET name=_payload->>'name', photo_url=nullif(_payload->>'photo_url',''),
      value_inr=coalesce((_payload->>'value_inr')::numeric,0),
      quantity=CASE WHEN _type='leaderboard' THEN _rt-_rf+1 ELSE greatest(coalesce((_payload->>'quantity')::int,1),1) END,
      sort_no=coalesce((_payload->>'sort_no')::int,0), rank_from=CASE WHEN _type='leaderboard' THEN _rf END, rank_to=CASE WHEN _type='leaderboard' THEN _rt END
    WHERE id=_id RETURNING id, campaign_id INTO _new, _campaign_id;
  END IF;
  PERFORM lucky_draw_audit('lucky_draw_prize_saved', _campaign_id, NULL, _payload || jsonb_build_object('prize_id', _new));
  RETURN _new;
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_delete_prize(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b jsonb;
BEGIN
  PERFORM staff_require_super_admin();
  SELECT to_jsonb(p) INTO _b FROM lucky_draw_prizes p WHERE id=_id;
  DELETE FROM lucky_draw_prizes WHERE id=_id;
  PERFORM lucky_draw_audit('lucky_draw_prize_deleted', (_b->>'campaign_id')::uuid, _b, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_overview(_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM staff_require_super_admin();
  SELECT jsonb_build_object(
    'enrolled', count(*), 'total_entries', coalesce(sum(entries),0),
    'enrolments', coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'entry_no',entry_no,'full_name',full_name,'phone',phone,
       'referrals',referrals,'entries',entries,'rank',rank,'enrolled_at',enrolled_at) ORDER BY rank), '[]'::jsonb))
  INTO _r FROM lucky_draw_standings(_campaign_id);
  RETURN _r || jsonb_build_object('winners', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'prize_type',w.prize_type,'rank',w.rank,'entries',w.entries,'referrals',w.referrals,
      'prize_name',p.name,'prize_value',p.value_inr,'sort_no',p.sort_no,'full_name',u.full_name,'phone',u.phone,
      'entry_no',(SELECT entry_no FROM lucky_draw_enrolments e WHERE e.campaign_id=w.campaign_id AND e.user_id=w.user_id))
      ORDER BY w.prize_type DESC, p.sort_no, w.rank, w.created_at), '[]'::jsonb)
    FROM lucky_draw_winners w LEFT JOIN lucky_draw_prizes p ON p.id=w.prize_id LEFT JOIN users u ON u.id=w.user_id
    WHERE w.campaign_id=_campaign_id));
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_run(_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c lucky_draw_campaigns; _seed text := encode(gen_random_bytes(16),'hex'); _enrolled int; p record; i int; _pick record; _won uuid[] := '{}'; _lucky int := 0; _lb int := 0;
BEGIN
  PERFORM staff_require_super_admin();
  SELECT * INTO c FROM lucky_draw_campaigns WHERE id=_campaign_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF c.draw_executed_at IS NOT NULL THEN RAISE EXCEPTION 'Draw already run. Reset it first (with reason) to run again.'; END IF;
  SELECT count(*) INTO _enrolled FROM lucky_draw_enrolments WHERE campaign_id=_campaign_id;
  IF now() < c.end_at AND (c.enrolment_target <= 0 OR _enrolled < c.enrolment_target) THEN
    RAISE EXCEPTION 'Draw allowed only after end date or once target is reached'; END IF;
  IF _enrolled = 0 THEN RAISE EXCEPTION 'No enrolments'; END IF;

  CREATE TEMP TABLE _st ON COMMIT DROP AS SELECT * FROM lucky_draw_standings(_campaign_id, c.end_at);
  -- Deterministic randomness from the saved seed
  PERFORM setseed(((('x'||left(_seed,8))::bit(32)::bigint)::float8 / 4294967295.0) * 2 - 1);
  CREATE TEMP TABLE _keys ON COMMIT DROP AS
    SELECT user_id, entries, referrals, -ln(greatest(random(),1e-12)) / entries AS k FROM (SELECT * FROM _st ORDER BY entry_no) s;

  FOR p IN SELECT * FROM lucky_draw_prizes WHERE campaign_id=_campaign_id AND prize_type='lucky_draw' ORDER BY sort_no, created_at LOOP
    FOR i IN 1..p.quantity LOOP
      SELECT * INTO _pick FROM _keys WHERE NOT (user_id = ANY(_won)) ORDER BY k LIMIT 1;
      EXIT WHEN _pick.user_id IS NULL;
      INSERT INTO lucky_draw_winners(campaign_id, prize_id, user_id, prize_type, entries, referrals)
      VALUES (_campaign_id, p.id, _pick.user_id, 'lucky_draw', _pick.entries, _pick.referrals);
      _won := _won || _pick.user_id; _lucky := _lucky + 1; _pick := NULL;
    END LOOP;
  END LOOP;

  IF c.leaderboard_rewards_enabled THEN
    INSERT INTO lucky_draw_winners(campaign_id, prize_id, user_id, prize_type, rank, entries, referrals)
    SELECT _campaign_id, p.id, s.user_id, 'leaderboard', s.rank, s.entries, s.referrals
    FROM lucky_draw_prizes p JOIN _st s ON s.rank BETWEEN p.rank_from AND p.rank_to
    WHERE p.campaign_id=_campaign_id AND p.prize_type='leaderboard' AND s.rank <= c.leaderboard_top_ranks;
    GET DIAGNOSTICS _lb = ROW_COUNT;
  END IF;

  UPDATE lucky_draw_campaigns SET draw_executed_at=now(), draw_seed=_seed WHERE id=_campaign_id;
  PERFORM lucky_draw_audit('lucky_draw_run', _campaign_id, NULL, jsonb_build_object('seed',_seed,'run_at',now(),'enrolled',_enrolled,
    'winners',(SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'prize_id',prize_id,'type',prize_type,'rank',rank)) FROM lucky_draw_winners WHERE campaign_id=_campaign_id)));
  RETURN jsonb_build_object('seed',_seed,'lucky_winners',_lucky,'leaderboard_winners',_lb);
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_reset(_campaign_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b jsonb;
BEGIN
  PERFORM staff_require_super_admin();
  IF coalesce(length(trim(_reason)),0) < 5 THEN RAISE EXCEPTION 'Reason is required (min 5 characters)'; END IF;
  SELECT jsonb_build_object('seed',draw_seed,'run_at',draw_executed_at,'winners',
    (SELECT jsonb_agg(to_jsonb(w)) FROM lucky_draw_winners w WHERE campaign_id=_campaign_id)) INTO _b
  FROM lucky_draw_campaigns WHERE id=_campaign_id;
  DELETE FROM lucky_draw_winners WHERE campaign_id=_campaign_id;
  UPDATE lucky_draw_campaigns SET draw_executed_at=NULL, draw_seed=NULL, winners_published=false WHERE id=_campaign_id;
  PERFORM lucky_draw_audit('lucky_draw_reset', _campaign_id, _b, jsonb_build_object('reason',_reason));
END $$;

CREATE OR REPLACE FUNCTION public.staff_lucky_draw_publish(_campaign_id uuid, _published boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM staff_require_super_admin();
  IF _published AND NOT EXISTS (SELECT 1 FROM lucky_draw_campaigns WHERE id=_campaign_id AND draw_executed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Run the draw before publishing winners'; END IF;
  UPDATE lucky_draw_campaigns SET winners_published=_published WHERE id=_campaign_id;
  PERFORM lucky_draw_audit('lucky_draw_publish', _campaign_id, NULL, jsonb_build_object('published',_published));
END $$;

-- ===== Customer-facing =====
CREATE OR REPLACE FUNCTION public.customer_lucky_draw_enrol()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c lucky_draw_campaigns; u users; _no text; _phone10 text; _existing text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  SELECT * INTO u FROM users WHERE id=auth.uid() AND deleted_at IS NULL;
  IF u.id IS NULL OR coalesce(u.phone,'') = '' THEN RAISE EXCEPTION 'Verified mobile number required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id=auth.uid() AND (au.phone_confirmed_at IS NOT NULL OR au.phone IS NOT NULL OR au.email_confirmed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Verified mobile number required'; END IF;
  _phone10 := right(regexp_replace(u.phone,'\D','','g'),10);
  IF EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id=auth.uid())
     OR EXISTS (SELECT 1 FROM experts e WHERE e.auth_user_id=auth.uid() OR right(regexp_replace(e.phone,'\D','','g'),10)=_phone10)
     OR EXISTS (SELECT 1 FROM internal_testers t WHERE right(regexp_replace(t.phone,'\D','','g'),10)=_phone10) THEN
    RAISE EXCEPTION 'This account is not eligible for the lucky draw'; END IF;
  SELECT * INTO c FROM lucky_draw_campaigns WHERE is_active FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'No active lucky draw'; END IF;
  IF now() < c.start_at THEN RAISE EXCEPTION 'Lucky draw has not started yet'; END IF;
  IF now() > c.end_at OR c.draw_executed_at IS NOT NULL THEN RAISE EXCEPTION 'Enrolment is closed'; END IF;
  SELECT entry_no INTO _existing FROM lucky_draw_enrolments WHERE campaign_id=c.id AND user_id=auth.uid();
  IF _existing IS NOT NULL THEN RETURN jsonb_build_object('entry_no',_existing,'already_enrolled',true); END IF;
  UPDATE lucky_draw_campaigns SET entry_counter=entry_counter+1 WHERE id=c.id RETURNING 'BDY-'||lpad(entry_counter::text,5,'0') INTO _no;
  INSERT INTO lucky_draw_enrolments(campaign_id,user_id,entry_no) VALUES (c.id, auth.uid(), _no);
  RETURN jsonb_build_object('entry_no',_no,'already_enrolled',false);
END $$;

CREATE OR REPLACE FUNCTION public.customer_lucky_draw_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c lucky_draw_campaigns; me record; _cnt int;
BEGIN
  SELECT * INTO c FROM lucky_draw_campaigns WHERE is_active;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO _cnt FROM lucky_draw_enrolments WHERE campaign_id=c.id;
  SELECT * INTO me FROM lucky_draw_standings(c.id) s WHERE s.user_id=auth.uid();
  RETURN jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'banner_url',c.banner_url,'start_at',c.start_at,'end_at',c.end_at,
    'enrolment_target',c.enrolment_target,'enrolled_count',CASE WHEN c.show_enrolled_count THEN _cnt END,
    'show_leaderboard',c.show_leaderboard,'referral_bonus_enabled',c.referral_bonus_enabled,'winners_published',c.winners_published,
    'my', CASE WHEN me.user_id IS NULL THEN NULL ELSE jsonb_build_object('entry_no',me.entry_no,'referrals',me.referrals,'entries',me.entries,'rank',me.rank) END,
    'prizes',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',prize_type,'name',name,'photo_url',photo_url,'value_inr',value_inr,'quantity',quantity,'rank_from',rank_from,'rank_to',rank_to) ORDER BY prize_type, sort_no, rank_from),'[]'::jsonb) FROM lucky_draw_prizes WHERE campaign_id=c.id),
    'winners', CASE WHEN c.winners_published THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('type',w.prize_type,'rank',w.rank,'prize',p.name,'name',lucky_draw_display_name(u.full_name)) ORDER BY w.prize_type DESC, p.sort_no, w.rank),'[]'::jsonb)
       FROM lucky_draw_winners w LEFT JOIN lucky_draw_prizes p ON p.id=w.prize_id LEFT JOIN users u ON u.id=w.user_id WHERE w.campaign_id=c.id) END);
END $$;

CREATE OR REPLACE FUNCTION public.customer_lucky_draw_leaderboard(_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c lucky_draw_campaigns;
BEGIN
  SELECT * INTO c FROM lucky_draw_campaigns WHERE is_active;
  IF c.id IS NULL OR NOT c.show_leaderboard THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'name',lucky_draw_display_name(full_name),'referrals',referrals,'is_me',user_id=auth.uid()) ORDER BY rank),'[]'::jsonb)
    FROM lucky_draw_standings(c.id) WHERE rank <= least(greatest(_limit,1),500));
END $$;

REVOKE ALL ON FUNCTION public.staff_lucky_draw_save_campaign(uuid,jsonb), public.staff_lucky_draw_delete_campaign(uuid),
  public.staff_lucky_draw_save_prize(uuid,uuid,jsonb), public.staff_lucky_draw_delete_prize(uuid), public.staff_lucky_draw_overview(uuid),
  public.staff_lucky_draw_run(uuid), public.staff_lucky_draw_reset(uuid,text), public.staff_lucky_draw_publish(uuid,boolean),
  public.customer_lucky_draw_enrol(), public.customer_lucky_draw_status(), public.customer_lucky_draw_leaderboard(int),
  public.lucky_draw_audit(text,uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_lucky_draw_save_campaign(uuid,jsonb), public.staff_lucky_draw_delete_campaign(uuid),
  public.staff_lucky_draw_save_prize(uuid,uuid,jsonb), public.staff_lucky_draw_delete_prize(uuid), public.staff_lucky_draw_overview(uuid),
  public.staff_lucky_draw_run(uuid), public.staff_lucky_draw_reset(uuid,text), public.staff_lucky_draw_publish(uuid,boolean),
  public.customer_lucky_draw_enrol(), public.customer_lucky_draw_status(), public.customer_lucky_draw_leaderboard(int) TO authenticated;
REVOKE ALL ON FUNCTION public.lucky_draw_audit(text,uuid,jsonb,jsonb) FROM authenticated;
