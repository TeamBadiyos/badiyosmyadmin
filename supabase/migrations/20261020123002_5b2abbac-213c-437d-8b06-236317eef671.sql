CREATE OR REPLACE FUNCTION public.expert_has_active_job(_e uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.bookings b WHERE b.assigned_expert_id=_e AND b.deleted_at IS NULL
                 AND b.status IN ('expert_assigned','on_the_way','arrived','in_progress'))
      OR EXISTS (SELECT 1 FROM public.courier_orders c WHERE c.assigned_expert_id=_e
                 AND c.status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT'))
$$;

CREATE OR REPLACE FUNCTION public.expert_release_busy_if_idle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _e uuid := OLD.assigned_expert_id;
BEGIN
  IF _e IS NOT NULL AND (TG_OP='DELETE' OR NEW.assigned_expert_id IS DISTINCT FROM _e
       OR NEW.status IS DISTINCT FROM OLD.status) THEN
    UPDATE public.experts SET is_busy=false
     WHERE id=_e AND is_busy AND NOT public.expert_has_active_job(_e);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS zz_release_expert_busy ON public.bookings;
CREATE TRIGGER zz_release_expert_busy AFTER UPDATE OF status, assigned_expert_id, deleted_at OR DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.expert_release_busy_if_idle();
DROP TRIGGER IF EXISTS zz_release_expert_busy ON public.courier_orders;
CREATE TRIGGER zz_release_expert_busy AFTER UPDATE OF status, assigned_expert_id OR DELETE ON public.courier_orders
FOR EACH ROW EXECUTE FUNCTION public.expert_release_busy_if_idle();

CREATE OR REPLACE FUNCTION public.staff_force_expert_offline(_expert_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.experts SET is_online = false,
         is_busy = CASE WHEN public.expert_has_active_job(_expert_id) THEN is_busy ELSE false END
   WHERE id = _expert_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'force_expert_offline', 'experts', _expert_id, NULL, jsonb_build_object('is_online', false));
  BEGIN
    PERFORM public.notify_expert_alert(_expert_id, 'forced_offline', 'You have been set offline',
      'The office has set you offline. Tap to go online again when you are available.',
      jsonb_build_object('route', 'home'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[staff_force_expert_offline notify] %', SQLERRM;
  END;
END $function$;

UPDATE public.experts SET is_busy=false WHERE is_busy AND NOT public.expert_has_active_job(id);