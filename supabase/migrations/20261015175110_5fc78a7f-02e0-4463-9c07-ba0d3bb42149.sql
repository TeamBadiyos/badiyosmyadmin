DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.fin_overview(date,date)'::regprocedure) INTO d;
  d := replace(d, 'WHERE coalesce(is_active, true) AND', 'WHERE status = ''active'' AND');
  EXECUTE d;
END $$;