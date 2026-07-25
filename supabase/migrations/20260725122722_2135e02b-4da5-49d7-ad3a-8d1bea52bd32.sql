
-- staff_verify_start_otp: super_admin/ops_manager confirm the start OTP relayed by the expert.
CREATE OR REPLACE FUNCTION public.staff_verify_start_otp(_booking_id uuid, _otp text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _b record;
  _duration int;
  _now timestamptz := now();
  _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, status, start_otp, service_duration_minutes, deleted_at
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _b.status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking is not awaiting start'; END IF;
  IF _b.start_otp IS NULL OR btrim(_b.start_otp) = '' THEN RAISE EXCEPTION 'No start OTP set'; END IF;
  IF btrim(_otp) <> _b.start_otp THEN RAISE EXCEPTION 'Invalid start OTP'; END IF;

  _duration := COALESCE(_b.service_duration_minutes, 60);
  _end := _now + make_interval(mins => _duration);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'in_progress',
         started_at = _now,
         service_end_at = _end,
         updated_at = _now
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    _uid,
    'staff_relayed_start_otp',
    'bookings',
    _booking_id,
    jsonb_build_object('status', _b.status),
    jsonb_build_object(
      'status', 'in_progress',
      'started_at', _now,
      'service_end_at', _end,
      'note', 'OTP relayed by expert via phone/WhatsApp; verified by staff (interim flow).'
    )
  );
END;$function$;

REVOKE ALL ON FUNCTION public.staff_verify_start_otp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_verify_start_otp(uuid, text) TO authenticated;

-- staff_verify_end_otp: super_admin/ops_manager confirm the end OTP relayed by the expert.
CREATE OR REPLACE FUNCTION public.staff_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _b record;
  _now timestamptz := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, status, end_otp, deleted_at
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking is not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_b.end_otp) = '' THEN RAISE EXCEPTION 'No end OTP set'; END IF;
  IF btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed',
         service_end_at = COALESCE(service_end_at, _now),
         updated_at = _now
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    _uid,
    'staff_relayed_end_otp',
    'bookings',
    _booking_id,
    jsonb_build_object('status', _b.status),
    jsonb_build_object(
      'status', 'completed',
      'completed_at', _now,
      'note', 'OTP relayed by expert via phone/WhatsApp; verified by staff (interim flow).'
    )
  );
END;$function$;

REVOKE ALL ON FUNCTION public.staff_verify_end_otp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_verify_end_otp(uuid, text) TO authenticated;
