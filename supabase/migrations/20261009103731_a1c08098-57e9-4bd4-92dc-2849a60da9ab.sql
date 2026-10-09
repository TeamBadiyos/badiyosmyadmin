CREATE OR REPLACE FUNCTION public.expert_active_booking_count(_expert_id uuid, _exclude uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int FROM public.bookings b
   WHERE b.assigned_expert_id = _expert_id AND b.deleted_at IS NULL
     AND b.status IN ('expert_assigned','on_the_way','arrived','in_progress')
     AND (_exclude IS NULL OR b.id <> _exclude);
$$;
REVOKE ALL ON FUNCTION public.expert_active_booking_count(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expert_active_booking_count(uuid, uuid) TO authenticated;

DO $mig$
DECLARE _def text;
BEGIN
  _def := pg_get_functiondef('public.staff_assign_expert(uuid,uuid)'::regprocedure);
  _def := replace(_def,
    'IF _expert_busy THEN RAISE EXCEPTION ''Expert already has an active booking''; END IF;',
    'IF public.expert_active_booking_count(_expert_id, _booking_id) >= 2 THEN RAISE EXCEPTION ''Expert already has a running and an upcoming booking''; END IF;');
  EXECUTE _def;
  _def := pg_get_functiondef('public.staff_reassign_expert(uuid,uuid)'::regprocedure);
  _def := replace(_def,
    'IF _new_busy THEN RAISE EXCEPTION ''Expert already has an active booking''; END IF;',
    'IF public.expert_active_booking_count(_new_expert_id, _booking_id) >= 2 THEN RAISE EXCEPTION ''Expert already has a running and an upcoming booking''; END IF;');
  EXECUTE _def;
END $mig$;

-- Keep expert busy while a queued booking still exists (covers every completion path)
CREATE OR REPLACE FUNCTION public.experts_keep_busy_if_queued()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(OLD.is_busy,false) AND NOT COALESCE(NEW.is_busy,false)
     AND public.expert_active_booking_count(NEW.id) > 0 THEN
    NEW.is_busy := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_experts_keep_busy_if_queued ON public.experts;
CREATE TRIGGER trg_experts_keep_busy_if_queued BEFORE UPDATE OF is_busy ON public.experts
FOR EACH ROW EXECUTE FUNCTION public.experts_keep_busy_if_queued();