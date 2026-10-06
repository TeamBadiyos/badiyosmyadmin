INSERT INTO public.ops_settings (key, value, label)
VALUES ('service_extensions_enabled', '1', 'Allow customers to extend a running service (1 = on, 0 = off)')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.booking_extensions_guard_enabled()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE((SELECT value FROM public.ops_settings WHERE key = 'service_extensions_enabled'), '1') = '0' THEN
    RAISE EXCEPTION 'Service extension is currently turned off';
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS booking_extensions_guard_enabled ON public.booking_extensions;
CREATE TRIGGER booking_extensions_guard_enabled
BEFORE INSERT ON public.booking_extensions
FOR EACH ROW EXECUTE FUNCTION public.booking_extensions_guard_enabled();