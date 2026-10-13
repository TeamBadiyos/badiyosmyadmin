CREATE OR REPLACE FUNCTION public.reward_slot_start(_date date, _slot text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE m text[]; h int; mi int;
BEGIN
  IF _date IS NULL OR _slot IS NULL THEN RETURN NULL; END IF;
  m := regexp_match(_slot, '^\s*([0-9]{1,2})(?::([0-9]{2}))?\s*(AM|PM|am|pm)?');
  IF m IS NULL THEN RETURN NULL; END IF;
  h := m[1]::int; mi := COALESCE(m[2],'0')::int;
  IF upper(m[3]) = 'PM' AND h < 12 THEN h := h + 12; END IF;
  IF upper(m[3]) = 'AM' AND h = 12 THEN h := 0; END IF;
  IF h > 23 OR mi > 59 THEN RETURN NULL; END IF;
  RETURN (_date + make_time(h, mi, 0)) AT TIME ZONE 'Asia/Kolkata';
END $$;

CREATE OR REPLACE FUNCTION public.reward_gates_pass(_condition jsonb, _expert_id uuid, _start timestamptz, _end timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    IF _avg IS NOT NULL AND _avg < _min_rating THEN RETURN false; END IF;
  END IF;

  IF _no_complaints THEN
    IF EXISTS (
      SELECT 1 FROM public.support_tickets t
       WHERE t.resolution_outcome = 'expert_fault'
         AND t.created_at >= _start AND t.created_at < _end
         AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = t.booking_id AND b.assigned_expert_id = _expert_id)
    ) THEN RETURN false; END IF;
  END IF;

  IF _require_on_time AND public.get_ops_flag('reward_punctuality_gate_enabled') THEN
    SELECT COUNT(*) INTO _late FROM public.bookings b
     WHERE b.assigned_expert_id = _expert_id
       AND b.status = 'completed' AND NOT b.is_training
       AND b.started_at IS NOT NULL
       AND b.service_end_at >= _start AND b.service_end_at < _end
       AND public.reward_slot_start(b.scheduled_date, b.scheduled_time_slot) IS NOT NULL
       AND b.started_at > public.reward_slot_start(b.scheduled_date, b.scheduled_time_slot) + make_interval(mins => _grace);
    IF COALESCE(_late,0) > 0 THEN RETURN false; END IF;
  END IF;
  RETURN true;
END $function$;

SELECT public.run_reward_period_jobs('2026-10-05'::date);