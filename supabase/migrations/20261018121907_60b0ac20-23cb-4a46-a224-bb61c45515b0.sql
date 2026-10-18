REVOKE EXECUTE ON FUNCTION public.spin_sync_tokens() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spin_prize_given(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spin_refresh_given(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spin_prize_given(uuid), public.spin_refresh_given(uuid) TO service_role;