CREATE OR REPLACE FUNCTION public.require_staff()
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN; END IF;
  IF auth.role() IS NULL AND auth.uid() IS NULL THEN RETURN; END IF;
  IF public.is_active_staff(auth.uid()) OR public.is_area_partner_staff() THEN RETURN; END IF;
  RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
END $function$;

REVOKE EXECUTE ON FUNCTION public.require_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_staff() TO authenticated, service_role;