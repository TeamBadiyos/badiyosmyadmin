CREATE OR REPLACE FUNCTION public.staff_accept_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _is_staff boolean; _current text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT status INTO _current FROM public.bookings WHERE id = _booking_id;
  IF _current IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current <> 'confirmed' THEN RAISE EXCEPTION 'Booking not pending'; END IF;
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings SET status = 'accepted' WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_reject_booking(_booking_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _is_staff boolean; _current text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR _reason NOT IN ('CHANGED_MIND','NO_RESPONSE','DUPLICATE','OTHER')
    THEN RAISE EXCEPTION 'Invalid reason'; END IF;
  SELECT status INTO _current FROM public.bookings WHERE id = _booking_id;
  IF _current IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current <> 'confirmed' THEN RAISE EXCEPTION 'Booking not pending'; END IF;
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings SET status = 'rejected' WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_accept_booking(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_reject_booking(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_accept_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_reject_booking(uuid, text) TO authenticated;