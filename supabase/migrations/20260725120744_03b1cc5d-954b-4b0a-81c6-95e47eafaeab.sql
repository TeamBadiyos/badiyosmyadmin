
-- 1) Harden staff_assign_expert with row lock + atomic conditional update
CREATE OR REPLACE FUNCTION public.staff_assign_expert(_booking_id uuid, _expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _expert_ok boolean;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.experts WHERE id = _expert_id AND status = 'active')
    INTO _expert_ok;
  IF NOT _expert_ok THEN RAISE EXCEPTION 'Expert not available'; END IF;

  -- Row lock: serialize concurrent claim attempts on the same booking.
  SELECT status, assigned_expert_id
    INTO _current_status, _current_expert
    FROM public.bookings
    WHERE id = _booking_id
    FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _expert_id,
         status = 'expert_assigned'
   WHERE id = _booking_id
     AND status = 'accepted'
     AND assigned_expert_id IS NULL;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN
    RAISE EXCEPTION 'This booking has already been assigned';
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'assigned_by_staff', 'bookings', _booking_id, _before, _after);
END;
$function$;

-- 2) Generic claim function for future Expert App. Same atomic guarantees.
CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(_booking_id uuid, _expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _expert_ok boolean;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- For now, only active staff may execute. Once expert auth exists, this
  -- check will be replaced with a check that the caller IS this expert
  -- (e.g. via a public.experts.auth_user_id column). No backend rewrite needed
  -- beyond swapping this guard.
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.experts WHERE id = _expert_id AND status = 'active')
    INTO _expert_ok;
  IF NOT _expert_ok THEN RAISE EXCEPTION 'Expert not available'; END IF;

  SELECT status, assigned_expert_id
    INTO _current_status, _current_expert
    FROM public.bookings
    WHERE id = _booking_id
    FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _expert_id,
         status = 'expert_assigned'
   WHERE id = _booking_id
     AND status = 'accepted'
     AND assigned_expert_id IS NULL;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN
    RAISE EXCEPTION 'This booking has already been assigned';
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'claimed_by_expert', 'bookings', _booking_id, _before, _after);
END;
$function$;

-- Lock down execution: only authenticated users, gated internally by staff check.
REVOKE ALL ON FUNCTION public.staff_assign_expert(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_booking_as_expert(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_assign_expert(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_as_expert(uuid, uuid) TO authenticated;
