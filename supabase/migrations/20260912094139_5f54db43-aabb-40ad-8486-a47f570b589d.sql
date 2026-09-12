
GRANT EXECUTE ON FUNCTION public.system_pending_waitlist_whatsapp() TO service_role;
GRANT EXECUTE ON FUNCTION public.system_mark_waitlist_whatsapp(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_waitlist_for_expert(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_customer_user_push(uuid, text, text, text) TO service_role;
