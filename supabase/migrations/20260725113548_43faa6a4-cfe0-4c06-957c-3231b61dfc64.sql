
-- Rename status 'assigned' -> 'expert_assigned' in bookings and RPCs

UPDATE public.bookings SET status = 'expert_assigned' WHERE status = 'assigned';

CREATE OR REPLACE FUNCTION public.staff_assign_expert(_booking_id uuid, _expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _before jsonb;
  _after jsonb;
  _expert_ok boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.experts WHERE id = _expert_id AND status = 'active')
    INTO _expert_ok;
  IF NOT _expert_ok THEN RAISE EXCEPTION 'Expert not available'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF (_before->>'status') <> 'accepted' THEN RAISE EXCEPTION 'Booking not accepted'; END IF;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
    SET assigned_expert_id = _expert_id,
        status = 'expert_assigned'
    WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'assign_expert', 'bookings', _booking_id, _before, _after);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_update_booking_status(_booking_id uuid, _new_status text, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current text;
  _before jsonb;
  _after jsonb;
  _allowed boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT to_jsonb(b), status INTO _before, _current FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  IF _current = 'confirmed' AND _new_status IN ('accepted','rejected','cancelled') THEN _allowed := true;
  ELSIF _current = 'accepted' AND _new_status IN ('expert_assigned','cancelled','rejected') THEN _allowed := true;
  ELSIF _current = 'expert_assigned' AND _new_status IN ('in_progress','cancelled') THEN _allowed := true;
  ELSIF _current = 'in_progress' AND _new_status IN ('completed','cancelled') THEN _allowed := true;
  END IF;

  IF NOT _allowed THEN RAISE EXCEPTION 'Invalid status transition from % to %', _current, _new_status; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET status = _new_status WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'update_booking_status', 'bookings', _booking_id,
          _before || jsonb_build_object('note', _note),
          _after);
END;
$function$;
