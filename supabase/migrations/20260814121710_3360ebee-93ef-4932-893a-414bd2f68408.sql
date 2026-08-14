CREATE OR REPLACE FUNCTION public.staff_acknowledge_emergency_alert(_alert_id uuid, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  UPDATE public.emergency_alerts
    SET status = 'acknowledged',
        acknowledged_by = auth.uid(),
        acknowledged_at = now(),
        notes = COALESCE(_notes, notes)
    WHERE id = _alert_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_acknowledge_emergency_alert(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_acknowledge_emergency_alert(uuid, text) TO authenticated;

ALTER TABLE public.emergency_alerts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'emergency_alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_alerts';
  END IF;
END $$;