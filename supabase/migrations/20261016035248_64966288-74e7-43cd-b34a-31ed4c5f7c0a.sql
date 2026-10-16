ALTER FUNCTION public.city_ops_keys() SET search_path = public;
REVOKE ALL ON FUNCTION public.city_accept_timeout(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_accept_timeout(uuid, text) TO service_role;