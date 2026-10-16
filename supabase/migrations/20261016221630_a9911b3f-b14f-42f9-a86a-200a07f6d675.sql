ALTER FUNCTION public.default_cancel_policy() SET search_path TO 'public';
REVOKE EXECUTE ON FUNCTION public.booking_group_of(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_refund_split(uuid,text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.booking_cancel_core(uuid,text,uuid,text,text,text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.default_cancel_policy() FROM public, anon, authenticated;