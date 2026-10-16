REVOKE EXECUTE ON FUNCTION public.city_price_mirror_legacy() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spo_seed_city_prices() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spo_legacy_price_guard() FROM public, anon, authenticated;