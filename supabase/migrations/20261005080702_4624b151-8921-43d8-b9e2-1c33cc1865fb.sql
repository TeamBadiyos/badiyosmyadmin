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
  _new_busy boolean;
  _new_name text;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _started_at timestamptz;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT (status = 'active'), COALESCE(is_busy,false), name
    INTO _expert_ok, _new_busy, _new_name
    FROM public.experts WHERE id = _new_expert_id FOR UPDATE;
  IF NOT COALESCE(_expert_ok,false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _new_busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;

  SELECT status, assigned_expert_id, started_at INTO _current_status, _current_expert, _started_at
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT public.booking_expert_mode_ok(_booking_id, _new_expert_id) THEN
    RAISE EXCEPTION 'MODE_MISMATCH: Training bookings need a training expert, live bookings need a live expert.';
  END IF;
  -- Allow reassignment from expert_assigned, and also from on_the_way / arrived
  -- as long as the service has not started yet (start OTP not verified).
  IF _current_status NOT IN ('expert_assigned','on_the_way','arrived') OR _started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Booking cannot be reassigned in its current state';
  END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _new_expert_id,
         status = 'expert_assigned',
         on_the_way_at = NULL,
         arrived_at = NULL,
         onway_alert_sent = false,
         expert_assigned_at = now()
   WHERE id = _booking_id
     AND status = _current_status
     AND assigned_expert_id IS NOT DISTINCT FROM _current_expert;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN RAISE EXCEPTION 'Booking state changed, please refresh and try again'; END IF;

  IF _current_expert IS NOT NULL AND _current_expert <> _new_expert_id THEN
    UPDATE public.experts SET is_busy = false WHERE id = _current_expert;
    PERFORM public.notify_expert_push(
      _current_expert,
      'Booking reassigned',
      'This booking has been reassigned to another expert.',
      'home'
    );
  END IF;
  UPDATE public.experts SET is_busy = true WHERE id = _new_expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reassigned_by_staff', 'bookings', _booking_id, _before, _after);

  PERFORM public.notify_expert_push(
    _new_expert_id,
    'New booking assigned',
    'A booking has been assigned to you. Open the app to start.',
    'booking/' || _booking_id::text
  );

  PERFORM public.notify_customer_push(
    _booking_id,
    'Expert assigned!',
    COALESCE(_new_name, 'Your expert') || ' is on the way for your booking.',
    'booking/' || _booking_id::text
  );
END;
$function$