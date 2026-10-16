DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.booking_journey_sweeper()'::regprocedure) INTO d;
  d := replace(d, 'if _slot is not null and now() >= _slot + make_interval(mins => _refund) then',
    'if _slot is not null and b.broadcast_started_at is not null and now() >= b.broadcast_started_at + make_interval(mins => public.booking_auto_cancel_minutes(b.id)) then');
  IF position('booking_auto_cancel_minutes(b.id)' in d) = 0 THEN RAISE EXCEPTION 'booking_journey_sweeper patch failed'; END IF;
  EXECUTE d;
END $$;
UPDATE public.ops_settings SET value = value WHERE key = 'no_expert_refund_after_slot_minutes';
COMMENT ON TABLE public.ops_settings IS 'Shared ops settings. no_expert_refund_after_slot_minutes is LEGACY and unused; use city_ops_settings clean_/wash_auto_cancel_minutes.';