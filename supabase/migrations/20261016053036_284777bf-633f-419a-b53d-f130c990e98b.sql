DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.booking_journey_sweeper()'::regprocedure) INTO d;
  d := replace(d, 'and now() >= b.expert_assigned_at + interval ''2 minutes'' then',
    'and now() >= b.expert_assigned_at + interval ''2 minutes''
            and b.expert_assigned_at < _slot - make_interval(mins => _sched) then');
  IF position('b.expert_assigned_at < _slot - make_interval' in d) = 0 THEN RAISE EXCEPTION 'unassign patch failed'; END IF;
  EXECUTE d;
END $$;

DO $$ BEGIN
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET assigned_expert_id='fbfc5bee-8714-4ab7-b15d-cd3cff89194b',
    status='expert_assigned', expert_assigned_at=now()
  WHERE booking_number='CH-10212' AND status='accepted' AND assigned_expert_id IS NULL;
  PERFORM set_config('app.booking_bypass','off', true);
END $$;