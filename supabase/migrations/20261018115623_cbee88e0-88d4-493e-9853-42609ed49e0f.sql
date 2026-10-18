DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.zv2_save_zone(uuid,uuid,text,text,jsonb)'::regprocedure) INTO d;
  d := replace(d, 'delete from zv2_gp_auto;', 'delete from zv2_gp_auto where true;');
  EXECUTE d;
END $$;