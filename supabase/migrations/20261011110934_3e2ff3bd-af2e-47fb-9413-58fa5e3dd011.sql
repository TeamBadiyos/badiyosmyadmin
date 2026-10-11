INSERT INTO public.ops_settings(key, value, label) VALUES ('instant_auto_by_experts', to_jsonb('1'::text), 'Book Now auto-off when no free online Expert') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.instant_free_expert_count()
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT count(*)::int FROM public.experts
   WHERE status='active' AND is_online = true AND COALESCE(is_busy,false) = false
$$;
GRANT EXECUTE ON FUNCTION public.instant_free_expert_count() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.instant_booking_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='instant_booking_enabled')),'1') <> '0'
     AND (coalesce(trim(both '"' from (SELECT value::text FROM public.ops_settings WHERE key='instant_auto_by_experts')),'1') = '0'
          OR public.instant_free_expert_count() > 0)
$$;
GRANT EXECUTE ON FUNCTION public.instant_booking_enabled() TO anon, authenticated;