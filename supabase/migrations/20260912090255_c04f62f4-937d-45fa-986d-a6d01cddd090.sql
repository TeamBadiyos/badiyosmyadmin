
REVOKE EXECUTE ON FUNCTION public.raise_dispatch_alert(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_zone_capacity(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.system_check_no_accept_alerts() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.system_pending_dispatch_whatsapp() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.system_mark_dispatch_whatsapp(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_dispatch_alert(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_zone_capacity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_check_no_accept_alerts() TO service_role;
GRANT EXECUTE ON FUNCTION public.system_pending_dispatch_whatsapp() TO service_role;
GRANT EXECUTE ON FUNCTION public.system_mark_dispatch_whatsapp(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.staff_update_dispatch_config(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.staff_save_capacity_message(jsonb) FROM anon;
