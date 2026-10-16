CREATE OR REPLACE FUNCTION public.cc_uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT auth.uid() $$;
REVOKE ALL ON FUNCTION public.cc_uid() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cc_uid() TO authenticated, service_role, cc_reader;

DO $$ DECLARE f record; d text; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
           WHERE n.nspname='public' AND r.rolname='cc_reader' LOOP
    d := pg_get_functiondef(f.oid);
    IF position('auth.uid()' in d) > 0 THEN
      EXECUTE replace(d, 'auth.uid()', 'public.cc_uid()');
    END IF;
  END LOOP; END $$;