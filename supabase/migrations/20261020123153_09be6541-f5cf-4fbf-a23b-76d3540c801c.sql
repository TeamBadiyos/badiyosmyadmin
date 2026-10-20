REVOKE EXECUTE ON FUNCTION public.expert_has_active_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expert_release_busy_if_idle() FROM PUBLIC, anon, authenticated;