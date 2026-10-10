CREATE TABLE public.lucky_draw_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.lucky_draw_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ticket_no text NOT NULL,
  ticket_type text NOT NULL DEFAULT 'base',
  referred_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, ticket_no)
);
CREATE UNIQUE INDEX lucky_draw_tickets_ref_uq ON public.lucky_draw_tickets(campaign_id, user_id, referred_user_id) WHERE referred_user_id IS NOT NULL;
CREATE INDEX ON public.lucky_draw_tickets(campaign_id, user_id);
GRANT SELECT ON public.lucky_draw_tickets TO authenticated;
GRANT ALL ON public.lucky_draw_tickets TO service_role;
ALTER TABLE public.lucky_draw_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ldt_read ON public.lucky_draw_tickets FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_super_admin_user());

ALTER TABLE public.lucky_draw_winners ADD COLUMN IF NOT EXISTS ticket_no text;

-- Ensure base + referral tickets exist for every enrolment of a campaign
CREATE OR REPLACE FUNCTION public.lucky_draw_sync_tickets(_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c lucky_draw_campaigns; r record; _no text; _n int := 0;
BEGIN
  SELECT * INTO c FROM lucky_draw_campaigns WHERE id=_campaign_id FOR UPDATE;
  IF c.id IS NULL OR c.draw_executed_at IS NOT NULL THEN RETURN 0; END IF;
  INSERT INTO lucky_draw_tickets(campaign_id,user_id,ticket_no,ticket_type,created_at)
  SELECT e.campaign_id,e.user_id,e.entry_no,'base',e.enrolled_at FROM lucky_draw_enrolments e
  WHERE e.campaign_id=_campaign_id ON CONFLICT (campaign_id,ticket_no) DO NOTHING;
  IF NOT c.referral_bonus_enabled THEN RETURN 0; END IF;
  FOR r IN
    SELECT e.user_id, fe.user_id AS friend_id
    FROM lucky_draw_enrolments e JOIN users u ON u.id=e.user_id
    JOIN users fu ON u.referral_code IS NOT NULL AND fu.referred_by=u.referral_code AND fu.id<>u.id
    JOIN lucky_draw_enrolments fe ON fe.campaign_id=_campaign_id AND fe.user_id=fu.id
    WHERE e.campaign_id=_campaign_id AND (now() <= c.end_at)
      AND NOT EXISTS (SELECT 1 FROM lucky_draw_tickets t WHERE t.campaign_id=_campaign_id AND t.user_id=e.user_id AND t.referred_user_id=fu.id)
    ORDER BY greatest(e.enrolled_at, fe.enrolled_at)
  LOOP
    UPDATE lucky_draw_campaigns SET entry_counter=entry_counter+1 WHERE id=_campaign_id RETURNING 'BDY-'||lpad(entry_counter::text,5,'0') INTO _no;
    INSERT INTO lucky_draw_tickets(campaign_id,user_id,ticket_no,ticket_type,referred_user_id) VALUES (_campaign_id,r.user_id,_no,'referral',r.friend_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.lucky_draw_sync_tickets(uuid) FROM PUBLIC, anon, authenticated;

-- Backfill all campaigns not yet drawn
DO $$ DECLARE x uuid; BEGIN FOR x IN SELECT id FROM lucky_draw_campaigns WHERE draw_executed_at IS NULL LOOP PERFORM lucky_draw_sync_tickets(x); END LOOP; END $$;

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
  PERFORM lucky_draw_sync_tickets(c.id);
  RETURN jsonb_build_object('entry_no',_no,'already_enrolled',false);
END $$;

-- Status: add my tickets list
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
    'my', CASE WHEN me.user_id IS NULL THEN NULL ELSE jsonb_build_object('entry_no',me.entry_no,'referrals',me.referrals,
      'entries',(SELECT count(*) FROM lucky_draw_tickets t WHERE t.campaign_id=c.id AND t.user_id=auth.uid()),'rank',me.rank,
      'tickets',(SELECT coalesce(jsonb_agg(jsonb_build_object('ticket_no',t.ticket_no,'type',t.ticket_type,
          'friend_name',CASE WHEN t.referred_user_id IS NOT NULL THEN lucky_draw_display_name(fu.full_name) END,'created_at',t.created_at) ORDER BY t.ticket_no),'[]'::jsonb)
        FROM lucky_draw_tickets t LEFT JOIN users fu ON fu.id=t.referred_user_id WHERE t.campaign_id=c.id AND t.user_id=auth.uid())) END,
    'prizes',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',prize_type,'name',name,'photo_url',photo_url,'value_inr',value_inr,'quantity',quantity,'rank_from',rank_from,'rank_to',rank_to) ORDER BY prize_type, sort_no, rank_from),'[]'::jsonb) FROM lucky_draw_prizes WHERE campaign_id=c.id),
    'winners', CASE WHEN c.winners_published THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('type',w.prize_type,'rank',w.rank,'prize',p.name,'ticket_no',w.ticket_no,'name',lucky_draw_display_name(u.full_name)) ORDER BY w.prize_type DESC, p.sort_no, w.rank),'[]'::jsonb)
       FROM lucky_draw_winners w LEFT JOIN lucky_draw_prizes p ON p.id=w.prize_id LEFT JOIN users u ON u.id=w.user_id WHERE w.campaign_id=c.id) END);
END $$;

-- Overview: add tickets per enrolment + winner ticket
CREATE OR REPLACE FUNCTION public.staff_lucky_draw_overview(_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM staff_require_super_admin();
  SELECT jsonb_build_object(
    'enrolled', count(*), 'total_entries', (SELECT count(*) FROM lucky_draw_tickets WHERE campaign_id=_campaign_id),
    'enrolments', coalesce(jsonb_agg(jsonb_build_object('user_id',s.user_id,'entry_no',s.entry_no,'full_name',s.full_name,'phone',s.phone,
       'referrals',s.referrals,'rank',s.rank,'enrolled_at',s.enrolled_at,
       'tickets',(SELECT coalesce(jsonb_agg(t.ticket_no ORDER BY t.ticket_no),'[]'::jsonb) FROM lucky_draw_tickets t WHERE t.campaign_id=_campaign_id AND t.user_id=s.user_id),
       'entries',(SELECT count(*) FROM lucky_draw_tickets t WHERE t.campaign_id=_campaign_id AND t.user_id=s.user_id)) ORDER BY s.rank), '[]'::jsonb))
  INTO _r FROM lucky_draw_standings(_campaign_id) s;
  RETURN _r || jsonb_build_object('winners', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'prize_type',w.prize_type,'rank',w.rank,'entries',w.entries,'referrals',w.referrals,
      'prize_name',p.name,'prize_value',p.value_inr,'sort_no',p.sort_no,'full_name',u.full_name,'phone',u.phone,
      'entry_no',coalesce(w.ticket_no,(SELECT entry_no FROM lucky_draw_enrolments e WHERE e.campaign_id=w.campaign_id AND e.user_id=w.user_id)))
      ORDER BY w.prize_type DESC, p.sort_no, w.rank, w.created_at), '[]'::jsonb)
    FROM lucky_draw_winners w LEFT JOIN lucky_draw_prizes p ON p.id=w.prize_id LEFT JOIN users u ON u.id=w.user_id
    WHERE w.campaign_id=_campaign_id));
END $$;

-- Draw: pick uniformly among tickets (one prize per customer)
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
  PERFORM lucky_draw_sync_tickets(_campaign_id);

  CREATE TEMP TABLE _st ON COMMIT DROP AS SELECT * FROM lucky_draw_standings(_campaign_id, c.end_at);
  PERFORM setseed(((('x'||left(_seed,8))::bit(32)::bigint)::float8 / 4294967295.0) * 2 - 1);
  CREATE TEMP TABLE _keys ON COMMIT DROP AS
    SELECT t.user_id, t.ticket_no, s.entries, s.referrals, random() AS k
    FROM (SELECT * FROM lucky_draw_tickets WHERE campaign_id=_campaign_id AND (c.referral_bonus_enabled OR ticket_type='base') ORDER BY ticket_no) t
    JOIN _st s ON s.user_id=t.user_id;

  FOR p IN SELECT * FROM lucky_draw_prizes WHERE campaign_id=_campaign_id AND prize_type='lucky_draw' ORDER BY sort_no, created_at LOOP
    FOR i IN 1..p.quantity LOOP
      SELECT * INTO _pick FROM _keys WHERE NOT (user_id = ANY(_won)) ORDER BY k LIMIT 1;
      EXIT WHEN _pick.user_id IS NULL;
      INSERT INTO lucky_draw_winners(campaign_id, prize_id, user_id, prize_type, entries, referrals, ticket_no)
      VALUES (_campaign_id, p.id, _pick.user_id, 'lucky_draw', _pick.entries, _pick.referrals, _pick.ticket_no);
      _won := _won || _pick.user_id; _lucky := _lucky + 1; _pick := NULL;
    END LOOP;
  END LOOP;

  IF c.leaderboard_rewards_enabled THEN
    INSERT INTO lucky_draw_winners(campaign_id, prize_id, user_id, prize_type, rank, entries, referrals, ticket_no)
    SELECT _campaign_id, p.id, s.user_id, 'leaderboard', s.rank, s.entries, s.referrals, s.entry_no
    FROM lucky_draw_prizes p JOIN _st s ON s.rank BETWEEN p.rank_from AND p.rank_to
    WHERE p.campaign_id=_campaign_id AND p.prize_type='leaderboard' AND s.rank <= c.leaderboard_top_ranks;
    GET DIAGNOSTICS _lb = ROW_COUNT;
  END IF;

  UPDATE lucky_draw_campaigns SET draw_executed_at=now(), draw_seed=_seed WHERE id=_campaign_id;
  PERFORM lucky_draw_audit('lucky_draw_run', _campaign_id, NULL, jsonb_build_object('seed',_seed,'run_at',now(),'enrolled',_enrolled,
    'winners',(SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'prize_id',prize_id,'type',prize_type,'rank',rank,'ticket_no',ticket_no)) FROM lucky_draw_winners WHERE campaign_id=_campaign_id)));
  RETURN jsonb_build_object('seed',_seed,'lucky_winners',_lucky,'leaderboard_winners',_lb);
END $$;