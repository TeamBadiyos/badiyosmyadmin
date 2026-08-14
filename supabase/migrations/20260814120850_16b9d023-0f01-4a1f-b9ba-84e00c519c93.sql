CREATE OR REPLACE FUNCTION public.staff_accept_booking(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current text;
  _addr uuid;
  _lat numeric;
  _lng numeric;
  _zone uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  SELECT status, address_id INTO _current, _addr FROM public.bookings WHERE id = _booking_id;
  IF _current IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current <> 'confirmed' THEN RAISE EXCEPTION 'Booking not pending'; END IF;
  IF _addr IS NOT NULL THEN
    SELECT latitude, longitude INTO _lat, _lng FROM public.addresses WHERE id = _addr;
    _zone := public.resolve_zone_for_point(_lat, _lng);
  END IF;
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings SET status = 'accepted', zone_id = COALESCE(_zone, zone_id) WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);
END;$function$;

CREATE OR REPLACE FUNCTION public.staff_reject_booking(_booking_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _current text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  IF _reason IS NULL OR _reason NOT IN ('CHANGED_MIND','NO_RESPONSE','DUPLICATE','OTHER')
    THEN RAISE EXCEPTION 'Invalid reason'; END IF;
  SELECT status INTO _current FROM public.bookings WHERE id = _booking_id;
  IF _current IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current <> 'confirmed' THEN RAISE EXCEPTION 'Booking not pending'; END IF;
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings SET status = 'rejected' WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_assign_expert(_booking_id uuid, _expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _expert_ok boolean;
  _expert_busy boolean;
  _expert_name text;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  SELECT (status = 'active'), COALESCE(is_busy,false), name
    INTO _expert_ok, _expert_busy, _expert_name
    FROM public.experts WHERE id = _expert_id FOR UPDATE;
  IF NOT COALESCE(_expert_ok, false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _expert_busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;

  SELECT status, assigned_expert_id INTO _current_status, _current_expert
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _expert_id, status = 'expert_assigned'
   WHERE id = _booking_id AND status = 'accepted' AND assigned_expert_id IS NULL;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN RAISE EXCEPTION 'This booking has already been assigned'; END IF;

  UPDATE public.experts SET is_busy = true WHERE id = _expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'assigned_by_staff', 'bookings', _booking_id, _before, _after);

  PERFORM public.notify_customer_push(
    _booking_id,
    'Expert assigned!',
    COALESCE(_expert_name, 'Your expert') || ' is on the way for your booking.',
    'booking/' || _booking_id::text
  );
END;
$function$;