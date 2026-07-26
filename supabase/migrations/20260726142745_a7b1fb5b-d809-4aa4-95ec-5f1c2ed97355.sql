
ALTER FUNCTION public.set_login_pin(text) SET search_path = public, extensions;
ALTER FUNCTION public.verify_login_pin(text, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.verify_login_pin_internal(text, text) SET search_path = public, extensions;
