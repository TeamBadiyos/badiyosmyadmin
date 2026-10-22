DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.coins_release_stale_reservations()'::regprocedure) INTO d;
  IF position('''consumed''' in d) = 0 THEN RAISE EXCEPTION 'consumed not found'; END IF;
  EXECUTE replace(d, 'status = ''consumed''', 'status = ''used''');
END $$;