DO $$ DECLARE d text; BEGIN
SELECT pg_get_functiondef('public.partner_kpi_actuals(uuid,date)'::regprocedure) INTO d;
d := replace(d, 'DELETE FROM _kx;', 'DELETE FROM _kx WHERE true;');
EXECUTE d; END $$;