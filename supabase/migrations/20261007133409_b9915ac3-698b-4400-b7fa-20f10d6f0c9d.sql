DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('service_effective_state','service_next_open','store_max_radius_km','store_is_open_now','merchant_is_currently_open')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $$;
GRANT SELECT ON public.public_stores TO anon, authenticated;
GRANT SELECT ON public.public_products TO anon, authenticated;

DELETE FROM public.merchant_documents WHERE merchant_id = '36e2e184-71e9-4e43-b049-70c0ecb2aad3';
DELETE FROM public.merchants WHERE id = '36e2e184-71e9-4e43-b049-70c0ecb2aad3';