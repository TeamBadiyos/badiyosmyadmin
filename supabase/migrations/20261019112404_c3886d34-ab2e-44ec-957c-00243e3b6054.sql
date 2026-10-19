CREATE OR REPLACE FUNCTION public.outside_zone_policy(_city uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT 'block'::text $$;
INSERT INTO public.city_ops_settings(city_id, key, value, updated_at)
SELECT id, 'outside_zone_policy', 'block', now() FROM public.cities
ON CONFLICT (city_id, key) DO UPDATE SET value='block', updated_at=now();