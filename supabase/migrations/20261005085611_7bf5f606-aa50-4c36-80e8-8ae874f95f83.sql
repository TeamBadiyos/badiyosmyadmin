ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS staff_note text;

CREATE OR REPLACE FUNCTION public.staff_set_booking_note(_booking_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _role text; _old text; _new text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  _new := NULLIF(btrim(coalesce(_note,'')),'');
  IF _new IS NOT NULL AND length(_new) > 500 THEN RAISE EXCEPTION 'Note too long (max 500)'; END IF;
  SELECT staff_note INTO _old FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET staff_note = _new WHERE id = _booking_id;
  INSERT INTO public.audit_logs(actor_id, action, target_type, target_id, details)
  VALUES (_uid, 'booking_staff_note', 'booking', _booking_id, jsonb_build_object('before',_old,'after',_new));
END $$;
REVOKE ALL ON FUNCTION public.staff_set_booking_note(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_booking_note(uuid,text) TO authenticated;