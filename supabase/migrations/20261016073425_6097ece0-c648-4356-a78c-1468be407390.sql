DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.staff_dashboard_money(date,date)'::regprocedure);
  d := replace(d, 'sum(coalesce(price,0)+coalesce(discount_amount,0))', 'sum(coalesce(price,0))');
  EXECUTE d;
END $$;