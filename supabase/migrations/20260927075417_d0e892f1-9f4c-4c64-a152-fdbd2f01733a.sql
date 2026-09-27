CREATE OR REPLACE FUNCTION public.staff_set_booking_refund(
  _booking_id uuid,
  _refund_amount numeric,
  _refund_id text,
  _refund_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE b.id = _booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET refund_amount = COALESCE(_refund_amount, 0),
         refund_id = _refund_id,
         refund_status = _refund_status
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE b.id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'staff_booking_refund', 'bookings', _booking_id, _before, _after);

  IF _refund_status IS DISTINCT FROM 'failed' AND COALESCE(_refund_amount,0) > 0 THEN
    PERFORM public.notify_customer_push(
      _booking_id,
      'Refund initiated',
      'A refund of Rs ' || _refund_amount::text || ' has been sent to your original payment method. It may take 5-7 working days.',
      'home'
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'refund_amount', COALESCE(_refund_amount,0), 'refund_id', _refund_id, 'refund_status', _refund_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_set_booking_refund(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_booking_refund(uuid, numeric, text, text) TO authenticated, service_role;