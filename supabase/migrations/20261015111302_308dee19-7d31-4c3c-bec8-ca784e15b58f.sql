REVOKE ALL ON FUNCTION public.tax_rate(text) FROM public, anon, authenticated;
ALTER FUNCTION public.cron_minute_tick() SET search_path = public;