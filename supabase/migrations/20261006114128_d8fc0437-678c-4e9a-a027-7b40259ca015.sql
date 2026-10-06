CREATE OR REPLACE FUNCTION public.staff_update_booking_status(_booking_id uuid, _new_status text, _note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _role text; _current text; _assigned uuid;
  _before jsonb; _after jsonb; _allowed boolean := false; _body text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT to_jsonb(b), status, assigned_expert_id INTO _before, _current, _assigned
    FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  IF _current = 'confirmed' AND _new_status IN ('accepted','rejected','cancelled') THEN _allowed := true;
  ELSIF _current = 'accepted' AND _new_status IN ('expert_assigned','cancelled','rejected') THEN _allowed := true;
  ELSIF _current IN ('expert_assigned','on_the_way','arrived') AND _new_status IN ('in_progress','cancelled') THEN _allowed := true;
  ELSIF _current = 'in_progress' AND _new_status IN ('completed','cancelled') THEN _allowed := true;
  END IF;
  IF NOT _allowed THEN RAISE EXCEPTION 'Invalid status transition from % to %', _current, _new_status; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  IF _new_status = 'in_progress' THEN
    UPDATE public.bookings SET status = 'in_progress',
      started_at = COALESCE(started_at, now()),
      service_end_at = COALESCE(service_end_at, now() + make_interval(mins => COALESCE(service_duration_minutes, 60)))
    WHERE id = _booking_id;
  ELSE
    UPDATE public.bookings SET status = _new_status WHERE id = _booking_id;
  END IF;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL AND _new_status IN ('completed','cancelled','rejected')
     AND _current IN ('expert_assigned','on_the_way','arrived','in_progress') THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, CASE WHEN _new_status='in_progress' THEN 'staff_start_service_no_otp' ELSE 'update_booking_status' END,
          'bookings', _booking_id, _before || jsonb_build_object('note', _note), _after);

  IF _new_status = 'in_progress' AND _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_push(_assigned, 'Service started', 'Command Center has started this service. Timer is running.', 'home');
  END IF;

  IF _new_status = 'cancelled' THEN
    _body := 'Your booking has been cancelled.' ||
             CASE WHEN _note IS NOT NULL AND btrim(_note) <> '' THEN ' Reason: ' || _note ELSE '' END;
    PERFORM public.notify_customer_push(_booking_id, 'Booking cancelled', _body, 'home');
    IF _assigned IS NOT NULL AND _current IN ('expert_assigned','on_the_way','arrived','in_progress') THEN
      PERFORM public.notify_expert_push(_assigned, 'Booking cancelled', 'The booking assigned to you has been cancelled.', 'home');
    END IF;
  END IF;
END;
$function$;