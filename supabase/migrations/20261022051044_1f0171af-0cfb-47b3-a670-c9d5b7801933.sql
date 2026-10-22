DO $migration$
DECLARE _definition text;
BEGIN
  SELECT pg_get_functiondef('public.staff_generate_payout_batch_range(text,date,date,text)'::regprocedure) INTO _definition;
  IF position('l.created_at < _end_ts' in _definition) = 0 THEN RAISE EXCEPTION 'Expected payout date cutoff not found'; END IF;
  _definition := replace(_definition, 'l.created_at < _end_ts', 'l.effective_at < _end_ts');
  _definition := replace(_definition, 'l.created_at >= _start_ts', 'l.effective_at >= _start_ts');
  EXECUTE _definition;
END $migration$;
DO $test$
DECLARE _denied boolean := false;
BEGIN
  IF coalesce('2026-10-16'::date::timestamp AT TIME ZONE 'Asia/Kolkata', '2026-10-22T04:55:00Z'::timestamptz) <> '2026-10-15T18:30:00Z'::timestamptz THEN RAISE EXCEPTION 'Selected adjustment date test failed'; END IF;
  BEGIN
    PERFORM public.staff_wallet_adjust('expert', '00000000-0000-0000-0000-000000000000', 1, 'credit', 'Date validation test', '2026-10-16'::date);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IN ('Not authenticated', 'Access denied', 'Forbidden') THEN _denied := true; ELSE RAISE; END IF;
  END;
  IF NOT _denied THEN RAISE EXCEPTION 'Unauthenticated adjustment unexpectedly allowed'; END IF;
END $test$;