CREATE OR REPLACE FUNCTION public.staff_reward_period_preview(_period text, _period_start date)
 RETURNS TABLE(expert_id uuid, expert_name text, hours numeric, active_days numeric, orders numeric, category text, program_id uuid, program_name text, slab text, amount numeric, qualifies boolean, reason text)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.reward_programs;
  _start timestamptz; _end timestamptz; _ref text;
  _actor record; _threshold numeric; _metric numeric;
  _tier_group text; _tier_key text; _budget numeric; _spent numeric;
  _paid_tier jsonb := '{}'::jsonb;
  _cat text; _blocked text; _ok boolean;
BEGIN
  IF NOT public.is_super_admin_user() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;
  IF _period NOT IN ('weekly','monthly') THEN
    RAISE EXCEPTION 'Invalid period';
  END IF;

  _start := _period_start::timestamptz;
  _end := CASE WHEN _period = 'monthly' THEN _start + interval '1 month' ELSE _start + interval '7 days' END;

  CREATE TEMP TABLE IF NOT EXISTS _bp_metrics (
    id uuid, hours numeric, orders numeric, active_days numeric
  ) ON COMMIT DROP;
  DELETE FROM _bp_metrics;

  INSERT INTO _bp_metrics (id, hours, orders, active_days)
  SELECT b.assigned_expert_id,
         SUM(COALESCE(b.service_duration_minutes,0))::numeric / 60.0,
         COUNT(*)::numeric,
         0
    FROM public.bookings b
   WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL
     AND b.service_end_at >= _start AND b.service_end_at < _end
   GROUP BY b.assigned_expert_id;

  FOR _p IN
    SELECT rp.* FROM public.reward_programs rp
     JOIN public.reward_trigger_types tt ON tt.key = rp.trigger_type
     WHERE rp.is_active = true AND rp.archived_at IS NULL AND tt.is_time_based = true
       AND rp.actor_type = 'partner'
       AND rp.trigger_type IN ('hours_threshold','count_threshold','active_days_threshold')
       AND COALESCE(rp.condition->>'period','weekly') = _period
       AND (rp.valid_from IS NULL OR rp.valid_from <= now())
       AND (rp.valid_until IS NULL OR rp.valid_until >= now())
     ORDER BY COALESCE(rp.condition->>'tier_group',''), rp.reward_value DESC
  LOOP
    _tier_group := NULLIF(_p.condition->>'tier_group','');
    _ref := _p.trigger_type || ':' || _period || ':' || to_char(_start, 'YYYY-MM-DD');
    _cat := COALESCE(_tier_group,
             CASE WHEN _p.trigger_type = 'active_days_threshold' THEN 'active_bonus' ELSE 'standalone' END);

    _blocked := NULL;
    _budget := NULLIF(_p.condition->>'monthly_budget','')::numeric;
    IF _budget IS NOT NULL THEN
      SELECT COALESCE(SUM(reward_value),0) INTO _spent FROM public.reward_ledger
       WHERE program_id = _p.id AND status = 'credited'
         AND credited_at >= date_trunc('month', now());
      IF _spent >= _budget THEN
        _blocked := 'Monthly budget cap reached';
      END IF;
    END IF;

    FOR _actor IN
      SELECT m.id, m.hours, m.orders,
             (SELECT COUNT(*) FROM (
                SELECT (b2.service_end_at AT TIME ZONE 'Asia/Kolkata')::date AS d
                  FROM public.bookings b2
                 WHERE b2.assigned_expert_id = m.id AND b2.status = 'completed'
                   AND b2.service_end_at >= _start AND b2.service_end_at < _end
                 GROUP BY 1
                HAVING COUNT(*) >= COALESCE(NULLIF(_p.condition->>'orders_per_day','')::int, 1)
             ) q)::numeric AS active_days
        FROM _bp_metrics m
    LOOP
      IF _p.trigger_type = 'hours_threshold' THEN
        _threshold := COALESCE((_p.condition->>'hours')::numeric, 0);
        _metric := _actor.hours;
      ELSIF _p.trigger_type = 'count_threshold' THEN
        _threshold := COALESCE((_p.condition->>'count')::numeric, 0);
        _metric := _actor.orders;
      ELSE
        _threshold := COALESCE((_p.condition->>'days')::numeric, 0);
        _metric := _actor.active_days;
      END IF;

      _tier_key := COALESCE(_tier_group,'') || '|' || _actor.id::text;
      _ok := false;
      reason := NULL;

      IF _metric < _threshold THEN
        reason := 'Below target (' || round(_metric,1)::text || ' < ' || _threshold::text || ')';
      ELSIF _tier_group IS NOT NULL AND jsonb_exists(_paid_tier, _tier_key) THEN
        reason := 'Higher slab already applies in this category';
      ELSIF _blocked IS NOT NULL THEN
        reason := _blocked;
      ELSIF EXISTS (
        SELECT 1 FROM public.reward_ledger rl
         WHERE rl.program_id = _p.id AND rl.actor_id = _actor.id
           AND rl.trigger_event_ref = _ref AND rl.status = 'credited'
      ) THEN
        reason := 'Already credited for this period';
      ELSIF NOT public.reward_gates_pass(_p.condition, _actor.id, _start, _end) THEN
        reason := 'Quality gate failed (rating / complaint / on-time)';
      ELSE
        _ok := true;
        _paid_tier := CASE WHEN _tier_group IS NOT NULL
                           THEN _paid_tier || jsonb_build_object(_tier_key, true)
                           ELSE _paid_tier END;
      END IF;

      expert_id := _actor.id;
      SELECT e.full_name INTO expert_name FROM public.experts e WHERE e.id = _actor.id;
      hours := round(COALESCE(_actor.hours,0), 2);
      active_days := COALESCE(_actor.active_days,0);
      orders := COALESCE(_actor.orders,0);
      category := _cat;
      program_id := _p.id;
      program_name := _p.name;
      slab := _threshold::text;
      amount := CASE WHEN _ok THEN _p.reward_value ELSE 0 END;
      qualifies := _ok;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  RETURN;
END $function$;

REVOKE ALL ON FUNCTION public.staff_reward_period_preview(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reward_period_preview(text, date) TO authenticated, service_role;