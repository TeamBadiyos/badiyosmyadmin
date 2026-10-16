REVOKE ALL ON FUNCTION public.instant_slot_full(text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instant_slot_full(text, integer, uuid) TO service_role;