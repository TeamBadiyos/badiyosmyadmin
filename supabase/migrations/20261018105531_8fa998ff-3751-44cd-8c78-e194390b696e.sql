ALTER TABLE public.spin_prizes ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.spin_draws ADD COLUMN IF NOT EXISTS undo_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS redeem_method text, ADD COLUMN IF NOT EXISTS gate_label text, ADD COLUMN IF NOT EXISTS redeem_reason text;
CREATE INDEX IF NOT EXISTS spin_draws_user_idx ON public.spin_draws(user_id);

CREATE TABLE public.spin_prize_reminders (
  draw_id uuid NOT NULL REFERENCES public.spin_draws(id) ON DELETE CASCADE,
  kind text NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (draw_id, kind));
GRANT ALL ON public.spin_prize_reminders TO service_role;
ALTER TABLE public.spin_prize_reminders ENABLE ROW LEVEL SECURITY;

-- status: won | pending_undo | redeemed | expired
CREATE OR REPLACE FUNCTION public.spin_draw_status(_d spin_draws, _exp timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT CASE WHEN _d.redeemed_at IS NOT NULL AND _d.undo_deadline IS NOT NULL AND _d.undo_deadline > now() THEN 'pending_undo'
    WHEN _d.redeemed_at IS NOT NULL THEN 'redeemed'
    WHEN _exp IS NOT NULL AND _exp < now() THEN 'expired' ELSE 'won' END $$;

CREATE OR REPLACE FUNCTION public.spin_mask_phone(_p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(coalesce(_p,''))>=4 THEN 'XXXXXX'||right(_p,4) ELSE '' END $$;

-- ===== Customer App =====
CREATE OR REPLACE FUNCTION public.app_my_spin_prizes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'draw_id',d.id,'event_name',e.name,'event_name_mr',e.name_mr,'event_starts_at',e.starts_at,
    'prize',p.label,'prize_mr',p.label_mr,'color',p.color,'icon',p.icon,
    'code',d.redemption_code,'qr',d.redemption_code,'won_at',d.created_at,'expires_at',p.expires_at,
    'status',spin_draw_status(d,p.expires_at),'redeemed_at',d.redeemed_at,'undo_deadline',d.undo_deadline,
    'customer_name',u.full_name,'phone_masked',spin_mask_phone(d.phone)) ORDER BY d.created_at DESC),'[]')
    FROM spin_draws d JOIN spin_prizes p ON p.id=d.prize_id JOIN spin_events e ON e.id=d.event_id
    LEFT JOIN users u ON u.id=d.user_id
    WHERE d.user_id=auth.uid() AND d.prize_type='physical');
END $$;

CREATE OR REPLACE FUNCTION public.app_spin_prize_redeem(_draw_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws; v_exp timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO d FROM spin_draws WHERE id=_draw_id AND user_id=auth.uid() AND prize_type='physical' FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Prize not found'; END IF;
  SELECT expires_at INTO v_exp FROM spin_prizes WHERE id=d.prize_id;
  IF d.redeemed_at IS NOT NULL THEN RAISE EXCEPTION 'Already redeemed'; END IF;
  IF v_exp IS NOT NULL AND v_exp < now() THEN RAISE EXCEPTION 'Prize expired'; END IF;
  UPDATE spin_draws SET redeemed_at=now(), undo_deadline=now()+interval '5 seconds', redeem_method='app', redeemed_by=auth.uid()
    WHERE id=d.id RETURNING * INTO d;
  RETURN jsonb_build_object('ok',true,'status','pending_undo','redeemed_at',d.redeemed_at,'undo_deadline',d.undo_deadline);
END $$;

CREATE OR REPLACE FUNCTION public.app_spin_prize_undo(_draw_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  SELECT * INTO d FROM spin_draws WHERE id=_draw_id AND user_id=auth.uid() FOR UPDATE;
  IF d.id IS NULL OR d.redeem_method<>'app' OR d.undo_deadline IS NULL OR d.undo_deadline <= now() THEN
    RAISE EXCEPTION 'Undo time is over'; END IF;
  UPDATE spin_draws SET redeemed_at=NULL, undo_deadline=NULL, redeem_method=NULL, redeemed_by=NULL WHERE id=d.id;
  RETURN jsonb_build_object('ok',true,'status','won');
END $$;

-- ===== Staff: scan & redeem =====
CREATE OR REPLACE FUNCTION public.staff_spin_scan_check(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws; p spin_prizes; v_st text;
BEGIN
  IF public.cc_uid() IS NULL AND NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM spin_draws WHERE redemption_code=upper(trim(_code));
  IF d.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT * INTO p FROM spin_prizes WHERE id=d.prize_id;
  v_st := spin_draw_status(d,p.expires_at);
  RETURN jsonb_build_object('status', CASE v_st WHEN 'won' THEN 'valid' WHEN 'pending_undo' THEN 'used' WHEN 'redeemed' THEN 'used' ELSE v_st END,
    'code',d.redemption_code,'prize',p.label,'winner',(SELECT full_name FROM users WHERE id=d.user_id),
    'phone_masked',spin_mask_phone(d.phone),'won_at',d.created_at,'expires_at',p.expires_at,
    'redeemed_at',d.redeemed_at,'gate_label',d.gate_label,'method',d.redeem_method,
    'redeemed_by',(SELECT name FROM staff_users WHERE auth_user_id=d.redeemed_by));
END $$;

CREATE OR REPLACE FUNCTION public.staff_spin_scan_redeem(_code text, _gate text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws; v_exp timestamptz;
BEGIN
  IF public.cc_uid() IS NULL AND NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO d FROM spin_draws WHERE redemption_code=upper(trim(_code)) FOR UPDATE;
  IF d.id IS NULL THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF d.redeemed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'status','used','redeemed_at',d.redeemed_at,'gate_label',d.gate_label); END IF;
  SELECT expires_at INTO v_exp FROM spin_prizes WHERE id=d.prize_id;
  IF v_exp IS NOT NULL AND v_exp < now() THEN RETURN jsonb_build_object('ok',false,'status','expired','expires_at',v_exp); END IF;
  UPDATE spin_draws SET redeemed_at=now(), undo_deadline=NULL, redeemed_by=auth.uid(), redeem_method='scan',
    gate_label=nullif(trim(_gate),'') WHERE id=d.id;
  INSERT INTO audit_logs(actor_id, action, target_type, target_id, after_state)
  VALUES (auth.uid(),'spin_prize_redeemed','spin_draw',d.id,jsonb_build_object('code',d.redemption_code,'gate',_gate,'method','scan'));
  RETURN jsonb_build_object('ok',true,'status','redeemed');
END $$;

CREATE OR REPLACE FUNCTION public.staff_spin_redeem(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
  r := staff_spin_scan_redeem(_code, NULL);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION '%', CASE r->>'status' WHEN 'not_found' THEN 'Code not found' WHEN 'used' THEN 'Already redeemed' ELSE 'Prize expired' END; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.staff_spin_mark_redeemed(_draw_id uuid, _reason text, _gate text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d spin_draws;
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF length(trim(coalesce(_reason,''))) < 3 THEN RAISE EXCEPTION 'Reason is required'; END IF;
  SELECT * INTO d FROM spin_draws WHERE id=_draw_id AND prize_type='physical' FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Prize not found'; END IF;
  IF d.redeemed_at IS NOT NULL THEN RAISE EXCEPTION 'Already redeemed'; END IF;
  UPDATE spin_draws SET redeemed_at=now(), undo_deadline=NULL, redeemed_by=auth.uid(), redeem_method='manual',
    gate_label=nullif(trim(_gate),''), redeem_reason=trim(_reason) WHERE id=d.id;
  INSERT INTO audit_logs(actor_id, action, target_type, target_id, before_state, after_state)
  VALUES (auth.uid(),'spin_prize_manual_redeem','spin_draw',d.id,jsonb_build_object('redeemed_at',NULL),
    jsonb_build_object('reason',_reason,'gate',_gate,'code',d.redemption_code));
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.staff_spin_redemptions(_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN jsonb_build_object(
    'stock',(SELECT coalesce(sum(stock_limit),0) FROM spin_prizes WHERE event_id=_event_id AND prize_type='physical'),
    'unlimited',(SELECT bool_or(stock_limit IS NULL) FROM spin_prizes WHERE event_id=_event_id AND prize_type='physical' AND NOT is_deleted),
    'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'winner',u.full_name,'phone',d.phone,
      'phone_masked',spin_mask_phone(d.phone),'prize',p.label,'code',d.redemption_code,
      'status',spin_draw_status(d,p.expires_at),'won_at',d.created_at,'redeemed_at',d.redeemed_at,
      'expires_at',p.expires_at,'method',d.redeem_method,'gate',d.gate_label,'reason',d.redeem_reason,
      'staff',s.name) ORDER BY d.created_at DESC),'[]')
      FROM spin_draws d JOIN spin_prizes p ON p.id=d.prize_id LEFT JOIN users u ON u.id=d.user_id
      LEFT JOIN staff_users s ON s.auth_user_id=d.redeemed_by
      WHERE d.event_id=_event_id AND d.prize_type='physical'));
END $$;

-- ===== Reminders: daily 08:00 IST =====
CREATE OR REPLACE FUNCTION public.spin_send_prize_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; _n int := 0; _k text; _en text; _mr text;
BEGIN
  FOR r IN SELECT d.id, d.user_id, p.label, coalesce(p.label_mr,p.label) label_mr, p.expires_at, e.starts_at, e.name
    FROM spin_draws d JOIN spin_prizes p ON p.id=d.prize_id JOIN spin_events e ON e.id=d.event_id
    WHERE d.prize_type='physical' AND d.redeemed_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > now()) LOOP
    _k := NULL;
    IF r.expires_at IS NOT NULL AND (r.expires_at AT TIME ZONE 'Asia/Kolkata')::date = _today + 1 THEN _k := 'day_before';
    ELSIF (r.starts_at AT TIME ZONE 'Asia/Kolkata')::date = _today
       OR (r.expires_at IS NOT NULL AND (r.expires_at AT TIME ZONE 'Asia/Kolkata')::date = _today) THEN _k := 'event_morning'; END IF;
    CONTINUE WHEN _k IS NULL;
    INSERT INTO spin_prize_reminders(draw_id,kind) VALUES (r.id,_k) ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;
    IF _k='day_before' THEN
      _en := 'Your prize "'||r.label||'" expires tomorrow. Collect it from the counter 🎁';
      _mr := 'तुमचे बक्षीस "'||r.label_mr||'" उद्या संपेल. काउंटरवरून घ्या 🎁';
    ELSE
      _en := 'Today is the day! Show your prize "'||r.label||'" in Deals and collect it 🎁';
      _mr := 'आज दिवस आहे! Deals मध्ये तुमचे बक्षीस "'||r.label_mr||'" दाखवा आणि घ्या 🎁';
    END IF;
    PERFORM notify_push_event('customer', r.user_id, 'spin_prize_reminder', 'Collect your prize', _en,
      jsonb_build_object('route','deals','draw_id',r.id,'body_mr',_mr,'title_mr','तुमचे बक्षीस घ्या'));
    INSERT INTO party_notifications(party_type, party_id, auth_user_id, kind, title, body, data)
    VALUES ('customer', r.user_id, r.user_id, 'spin_prize_reminder', 'Collect your prize', _en,
      jsonb_build_object('route','deals','draw_id',r.id,'body_mr',_mr,'title_mr','तुमचे बक्षीस घ्या'));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
SELECT cron.schedule('spin-prize-reminders', '30 2 * * *', $$SELECT public.spin_send_prize_reminders()$$);

-- save prize expiry via staff_spin_save payloads
CREATE OR REPLACE FUNCTION public.staff_spin_set_prize_expiry(_prize_id uuid, _expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_offer_finance_user() THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE spin_prizes SET expires_at=_expires_at WHERE id=_prize_id AND prize_type='physical';
END $$;

REVOKE ALL ON FUNCTION public.app_my_spin_prizes(), public.app_spin_prize_redeem(uuid), public.app_spin_prize_undo(uuid),
  public.staff_spin_scan_check(text), public.staff_spin_scan_redeem(text,text), public.staff_spin_mark_redeemed(uuid,text,text),
  public.staff_spin_redemptions(uuid), public.spin_send_prize_reminders(), public.staff_spin_set_prize_expiry(uuid,timestamptz),
  public.spin_draw_status(spin_draws,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_my_spin_prizes(), public.app_spin_prize_redeem(uuid), public.app_spin_prize_undo(uuid),
  public.staff_spin_scan_check(text), public.staff_spin_scan_redeem(text,text), public.staff_spin_mark_redeemed(uuid,text,text),
  public.staff_spin_redemptions(uuid), public.staff_spin_set_prize_expiry(uuid,timestamptz) TO authenticated;