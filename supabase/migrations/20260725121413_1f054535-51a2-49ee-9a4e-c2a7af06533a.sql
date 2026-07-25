
CREATE OR REPLACE FUNCTION public.staff_reassign_expert(_booking_id uuid, _new_expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _expert_ok boolean;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT role INTO _role
    FROM public.staff_users
    WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin', 'ops_manager') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.experts WHERE id = _new_expert_id AND status = 'active')
    INTO _expert_ok;
  IF NOT _expert_ok THEN RAISE EXCEPTION 'Expert not available'; END IF;

  SELECT status, assigned_expert_id
    INTO _current_status, _current_expert
    FROM public.bookings
    WHERE id = _booking_id
    FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current_status <> 'expert_assigned' THEN
    RAISE EXCEPTION 'Booking cannot be reassigned in its current state';
  END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _new_expert_id
   WHERE id = _booking_id
     AND status = 'expert_assigned'
     AND assigned_expert_id = _current_expert;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN
    RAISE EXCEPTION 'Booking state changed, please refresh and try again';
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reassigned_by_staff', 'bookings', _booking_id, _before, _after);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_reassign_expert(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reassign_expert(uuid, uuid) TO authenticated;
