DO $do$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.app_commerce_home(text,uuid,double precision,double precision,uuid)'::regprocedure);
  d := replace(d, '_st jsonb;', '_st jsonb; _ids uuid[];');
  d := replace(d, 'CREATE TEMP TABLE IF NOT EXISTS _ch(id uuid) ON COMMIT DROP; TRUNCATE _ch;', '');
  d := replace(d, 'INSERT INTO _ch SELECT m.id FROM merchants m', 'SELECT coalesce(array_agg(m.id),''{}'') INTO _ids FROM merchants m');
  d := replace(d, 's.store_id IN (SELECT id FROM _ch)', 's.store_id = ANY(_ids)');
  d := replace(d, 'FROM _ch WHERE id <> ALL(_rec)', 'FROM unnest(_ids) id WHERE id <> ALL(_rec)');
  EXECUTE d;
END $do$;