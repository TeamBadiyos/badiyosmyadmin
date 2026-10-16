DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.app_categories(text,uuid)'::regprocedure);
  d := replace(d, 'm.store_category_id IN (SELECT d.id FROM store_categories d WHERE d.slug=c.slug OR c.slug LIKE d.slug||''-%'')',
                  'm.store_category_id IN (SELECT d.id FROM store_categories d WHERE d.name=c.name)');
  IF position('d.name=c.name' in d)=0 THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE d;
END $$;