CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, started_at INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;

  IF _b.status <> 'completed' THEN
    IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
    IF _b.started_at IS NOT NULL AND now() < _b.started_at + interval '5 minutes' THEN
      RAISE EXCEPTION 'Service started recently. Please wait at least 5 minutes after starting before completing the service.';
    END IF;
    IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings
       SET status = 'completed', service_end_at = now(), updated_at = now()
     WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;
  RETURN public.credit_booking_completion(_booking_id);
END $function$;