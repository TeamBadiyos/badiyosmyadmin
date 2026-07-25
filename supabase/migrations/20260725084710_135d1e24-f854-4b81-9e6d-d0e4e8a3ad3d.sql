
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE OR REPLACE FUNCTION public.staff_cancel_booking(_booking_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current text;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _reason IS NULL OR _reason NOT IN ('SAFETY','FRAUD','DUPLICATE','MANUAL_OVERRIDE','OTHER') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;

  SELECT to_jsonb(b), status INTO _before, _current FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Booking already in terminal state: %', _current;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'cancelled', cancellation_reason = _reason
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'cancel_booking', 'bookings', _booking_id, _before, _after);
END;$$;
