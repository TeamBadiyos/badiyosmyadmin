
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS resolution_outcome text;

INSERT INTO public.reward_trigger_types(key, label, description, actor_types, condition_schema, is_time_based, display_order, is_active)
VALUES (
  'active_days_threshold',
  'Active days (periodic)',
  'Rewards a partner for being active on a minimum number of days in the period.',
  ARRAY['partner'],
  '[{"field":"days","label":"Active days required","type":"number","default":25},
    {"field":"orders_per_day","label":"Minimum orders per active day","type":"number","default":3},
    {"field":"period","label":"Period","type":"select","options":["weekly","monthly"],"default":"monthly"}]'::jsonb,
  true, 10, true
)
ON CONFLICT (key) DO UPDATE
  SET condition_schema = EXCLUDED.condition_schema,
      actor_types = EXCLUDED.actor_types,
      is_time_based = true,
      is_active = true;

CREATE OR REPLACE FUNCTION public.reward_gates_pass(
  _condition jsonb, _expert_id uuid, _start timestamptz, _end timestamptz)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _min_rating numeric := NULLIF(_condition->>'min_avg_rating','')::numeric;
  _no_complaints boolean := COALESCE((_condition->>'no_complaints')::boolean, false);
  _grace integer := COALESCE(NULLIF(_condition->>'on_time_grace_minutes','')::integer, 15);
  _require_on_time boolean := COALESCE((_condition->>'require_on_time')::boolean, false);
  _avg numeric; _late integer;
BEGIN
  IF _min_rating IS NOT NULL THEN
    SELECT AVG(b.rating) INTO _avg FROM public.bookings b
     WHERE b.assigned_expert_id = _expert_id AND b.rating IS NOT NULL
       AND b.service_end_at >= _start AND b.service_end_at < _end;
    IF _avg IS NOT NULL AND _avg < _min_rating THEN
      RETURN false;
    END IF;
  END IF;

  IF _no_complaints THEN
    IF EXISTS (
      SELECT 1 FROM public.support_tickets t
       WHERE t.resolution_outcome = 'expert_fault'
         AND t.created_at >= _start AND t.created_at < _end
         AND EXISTS (SELECT 1 FROM public.bookings b
                      WHERE b.id = t.booking_id AND b.assigned_expert_id = _expert_id)
    ) THEN
      RETURN false;
    END IF;
  END IF;

  IF _require_on_time AND public.get_ops_flag('reward_punctuality_gate_enabled') THEN
    SELECT COUNT(*) INTO _late FROM public.bookings b
     WHERE b.assigned_expert_id = _expert_id
       AND b.status = 'completed'
       AND b.started_at IS NOT NULL
       AND b.scheduled_date IS NOT NULL
       AND b.scheduled_time_slot ~ '^[0-9]{1,2}:[0-9]{2}'
       AND b.service_end_at >= _start AND b.service_end_at < _end
       AND b.started_at >
           ((b.scheduled_date::text || ' ' || substring(b.scheduled_time_slot from '^[0-9]{1,2}:[0-9]{2}'))::timestamp
             AT TIME ZONE 'Asia/Kolkata') + make_interval(mins => _grace);
    IF COALESCE(_late,0) > 0 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.reward_gates_pass(jsonb, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reward_gates_pass(jsonb, uuid, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_reward_period_jobs(_force_period_start date DEFAULT NULL::date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _p public.reward_programs;
  _period text; _start timestamptz; _end timestamptz; _ref text;
  _granted integer := 0; _actor record; _threshold numeric;
  _tier_group text; _budget numeric; _spent numeric;
  _paid_tier jsonb := '{}'::jsonb; _tier_key text; _metric numeric;
BEGIN
  FOR _p IN
    SELECT rp.* FROM public.reward_programs rp
     JOIN public.reward_trigger_types tt ON tt.key = rp.trigger_type
     WHERE rp.is_active = true AND rp.archived_at IS NULL AND tt.is_time_based = true
       AND (rp.valid_from IS NULL OR rp.valid_from <= now())
       AND (rp.valid_until IS NULL OR rp.valid_until >= now())
     ORDER BY COALESCE(rp.condition->>'tier_group',''), rp.reward_value DESC
  LOOP
    _period := COALESCE(_p.condition->>'period', 'weekly');
    _tier_group := NULLIF(_p.condition->>'tier_group','');

    IF _force_period_start IS NOT NULL THEN
      _start := _force_period_start::timestamptz;
      _end := CASE WHEN _period = 'monthly' THEN _start + interval '1 month' ELSE _start + interval '7 days' END;
    ELSIF _period = 'monthly' THEN
      _start := date_trunc('month', now()) - interval '1 month';
      _end := date_trunc('month', now());
    ELSE
      _start := date_trunc('week', now()) - interval '7 days';
      _end := date_trunc('week', now());
    END IF;

    _ref := _p.trigger_type || ':' || _period || ':' || to_char(_start, 'YYYY-MM-DD');

    _budget := NULLIF(_p.condition->>'monthly_budget','')::numeric;
    IF _budget IS NOT NULL THEN
      SELECT COALESCE(SUM(reward_value),0) INTO _spent FROM public.reward_ledger
       WHERE program_id = _p.id AND status = 'credited'
         AND credited_at >= date_trunc('month', now());
      IF _spent >= _budget THEN
        INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
        VALUES (NULL, 'reward_budget_exceeded', 'reward_programs', _p.id, NULL,
                jsonb_build_object('program', _p.name, 'budget', _budget, 'spent', _spent,
                                   'status', 'budget_exceeded_pending_approval'));
        CONTINUE;
      END IF;
    END IF;

    IF _p.actor_type = 'partner' AND _p.trigger_type IN ('hours_threshold','count_threshold','active_days_threshold') THEN
      FOR _actor IN
        SELECT b.assigned_expert_id AS id,
               SUM(COALESCE(b.service_duration_minutes,0))::numeric / 60.0 AS hours,
               COUNT(*)::numeric AS orders,
               (SELECT COUNT(*) FROM (
                  SELECT (b2.service_end_at AT TIME ZONE 'Asia/Kolkata')::date AS d
                    FROM public.bookings b2
                   WHERE b2.assigned_expert_id = b.assigned_expert_id AND b2.status = 'completed'
                     AND b2.service_end_at >= _start AND b2.service_end_at < _end
                   GROUP BY 1
                  HAVING COUNT(*) >= COALESCE(NULLIF(_p.condition->>'orders_per_day','')::int, 1)
               ) q)::numeric AS active_days
          FROM public.bookings b
         WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL
           AND b.service_end_at >= _start AND b.service_end_at < _end
         GROUP BY b.assigned_expert_id
      LOOP
        _tier_key := COALESCE(_tier_group,'') || '|' || _actor.id::text;
        IF _tier_group IS NOT NULL AND jsonb_exists(_paid_tier, _tier_key) THEN
          CONTINUE;
        END IF;

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

        IF _metric >= _threshold AND public.reward_gates_pass(_p.condition, _actor.id, _start, _end) THEN
          IF public.reward_apply_credit(_p, _p.actor_type, _actor.id, _ref,
               'Period metric: ' || round(_metric, 2)::text) THEN
            _granted := _granted + 1;
            IF _tier_group IS NOT NULL THEN
              _paid_tier := _paid_tier || jsonb_build_object(_tier_key, true);
            END IF;
          END IF;
        END IF;
      END LOOP;

    ELSIF _p.trigger_type = 'count_threshold' AND _p.actor_type = 'customer' THEN
      _threshold := COALESCE((_p.condition->>'count')::numeric, 0);
      FOR _actor IN
        SELECT b.user_id AS id, count(*)::numeric AS metric
          FROM public.bookings b
         WHERE b.status = 'completed' AND b.user_id IS NOT NULL
           AND b.updated_at >= _start AND b.updated_at < _end
         GROUP BY b.user_id
      LOOP
        IF _actor.metric >= _threshold AND public.reward_apply_credit(
             _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
          _granted := _granted + 1;
        END IF;
      END LOOP;

    ELSIF _p.trigger_type = 'count_threshold' AND _p.actor_type = 'merchant' THEN
      _threshold := COALESCE((_p.condition->>'count')::numeric, 0);
      FOR _actor IN
        SELECT o.merchant_id AS id, count(*)::numeric AS metric
          FROM public.merchant_orders o
         WHERE o.status = 'completed'
           AND o.updated_at >= _start AND o.updated_at < _end
         GROUP BY o.merchant_id
      LOOP
        IF _actor.metric >= _threshold AND public.reward_apply_credit(
             _p, _p.actor_type, _actor.id, _ref, 'Count in period: ' || _actor.metric::text) THEN
          _granted := _granted + 1;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN _granted;
END $$;

REVOKE EXECUTE ON FUNCTION public.run_reward_period_jobs(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_reward_period_jobs(date) TO authenticated, service_role;
