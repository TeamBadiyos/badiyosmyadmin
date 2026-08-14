GRANT SELECT ON public.segments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.segments TO authenticated;
GRANT ALL ON public.segments TO service_role;

GRANT SELECT ON public.service_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_categories TO authenticated;
GRANT ALL ON public.service_categories TO service_role;

GRANT SELECT ON public.store_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_categories TO authenticated;
GRANT ALL ON public.store_categories TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_skills TO authenticated;
GRANT ALL ON public.partner_skills TO service_role;

GRANT SELECT, DELETE ON public.device_sessions TO authenticated;
GRANT ALL ON public.device_sessions TO service_role;