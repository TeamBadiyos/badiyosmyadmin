CREATE OR REPLACE FUNCTION public.service_extensions_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value::text NOT IN ('0','false','"0"','"false"') FROM public.ops_settings WHERE key = 'service_extensions_enabled' LIMIT 1),
    true
  )
$$;
GRANT EXECUTE ON FUNCTION public.service_extensions_enabled() TO anon, authenticated, service_role;