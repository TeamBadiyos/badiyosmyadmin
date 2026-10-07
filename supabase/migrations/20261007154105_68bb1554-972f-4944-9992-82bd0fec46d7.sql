DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.staff_sync_notifications()'::regprocedure);
  IF position('''product:''||' in d) > 0 THEN RETURN; END IF;
  d := replace(d,
    $a$    UNION ALL SELECT 'payout:'||p.id FROM public.payout_batches p WHERE p.status = 'pending'
  );$a$,
    $b$    UNION ALL SELECT 'payout:'||p.id FROM public.payout_batches p WHERE p.status = 'pending'
    UNION ALL SELECT 'product:'||pr.id FROM public.products pr WHERE pr.approval_status = 'pending'
  );$b$);
  IF position('''product:''||' in d) = 0 THEN RAISE EXCEPTION 'patch target not found'; END IF;
  EXECUTE d;
END $mig$;