UPDATE public.ops_settings
SET value = '180', updated_at = now()
WHERE key = 'courier_offer_timeout_seconds';

UPDATE public.ops_settings
SET value = '15', updated_at = now()
WHERE key = 'courier_search_timeout_minutes';