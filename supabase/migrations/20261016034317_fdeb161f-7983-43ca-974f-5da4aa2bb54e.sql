ALTER FUNCTION public.city_ops_keys() SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.city_ops_mirror_default(), public.city_svc_mirror_default(), public.cities_copy_ops() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_get_city_ops(uuid, text[]), public.staff_set_city_ops(uuid, jsonb), public.staff_set_city_service(uuid, text, jsonb) FROM PUBLIC, anon;
DROP POLICY "Anyone can read city ops settings" ON public.city_ops_settings;
REVOKE SELECT ON public.city_ops_settings FROM anon;
CREATE POLICY "Signed-in can read city ops settings" ON public.city_ops_settings FOR SELECT TO authenticated USING (true);