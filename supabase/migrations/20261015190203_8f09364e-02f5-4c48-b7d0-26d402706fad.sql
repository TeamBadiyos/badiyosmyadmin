DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.staff_list_refunds_all(text)'::regprocedure);
  IF position('upper(left(b.id::text,8)) order_number' in d)=0 THEN RAISE EXCEPTION 'patch target missing'; END IF;
  d := replace(d, 'upper(left(b.id::text,8)) order_number', 'coalesce(b.booking_number, upper(left(b.id::text,8))) order_number');
  EXECUTE d;
END $$;