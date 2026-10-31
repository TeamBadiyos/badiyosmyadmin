CREATE OR REPLACE FUNCTION public.reward_rating_factor(_condition jsonb, _expert_id uuid, _start timestamptz, _end timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE _avg numeric;
BEGIN
  IF NULLIF(_condition->>'min_avg_rating','') IS NULL THEN RETURN 1; END IF;
  SELECT AVG(b.rating) INTO _avg FROM public.bookings b
   WHERE b.assigned_expert_id = _expert_id AND b.rating IS NOT NULL
     AND b.service_end_at >= _start AND b.service_end_at < _end;
  IF _avg IS NULL OR _avg >= 4 THEN RETURN 1;
  ELSIF _avg >= 3 THEN RETURN 0.5;
  ELSE RETURN 0; END IF;
END $f$;
REVOKE EXECUTE ON FUNCTION public.reward_rating_factor(jsonb, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reward_rating_factor(jsonb, uuid, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reward_scale(_p public.reward_programs, _factor numeric)
RETURNS public.reward_programs LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $f$
BEGIN
  IF _factor < 1 THEN
    _p.reward_value := round(COALESCE(_p.reward_value,0) * _factor, 2);
    _p.name := _p.name || ' (50% – rating 3.0–3.9)';
  END IF;
  RETURN _p;
END $f$;

DO $do$
DECLARE _src text;
BEGIN
  _src := pg_get_functiondef('public.run_reward_period_jobs(date)'::regprocedure);
  _src := replace(_src,
    'IF _metric >= _threshold AND public.reward_gates_pass(_p.condition, _actor.id, _start, _end) THEN',
    'IF _metric >= _threshold AND public.reward_gates_pass(_p.condition - ''min_avg_rating'', _actor.id, _start, _end)
           AND public.reward_rating_factor(_p.condition, _actor.id, _start, _end) > 0 THEN');
  _src := regexp_replace(_src,
    'reward_apply_credit\(_p, _p\.actor_type, _actor\.id, _ref,(\s*)''Period metric',
    'reward_apply_credit(public.reward_scale(_p, public.reward_rating_factor(_p.condition, _actor.id, _start, _end)), _p.actor_type, _actor.id, _ref,\1''Period metric');
  IF position('reward_rating_factor(_p.condition, _actor.id, _start, _end)), _p.actor_type' in _src) = 0
     OR position('''min_avg_rating'', _actor.id' in _src) = 0 THEN
    RAISE EXCEPTION 'patch failed';
  END IF;
  EXECUTE _src;
END $do$;