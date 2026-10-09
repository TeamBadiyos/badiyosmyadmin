REVOKE ALL ON FUNCTION public.expert_active_booking_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.experts_keep_busy_if_queued() FROM PUBLIC, anon, authenticated;