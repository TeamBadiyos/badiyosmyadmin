REVOKE ALL ON FUNCTION public.outside_zone_policy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outside_zone_policy(uuid) TO service_role;