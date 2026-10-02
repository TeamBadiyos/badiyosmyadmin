CREATE OR REPLACE FUNCTION public.staff_set_booking_location(
  _booking_id uuid, _full_address text, _area text, _city text, _pincode text,
  _lat double precision, _lng double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _role text; b record; a record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _lat IS NULL OR _lng IS NULL OR _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Valid map pin required'; END IF;
  IF coalesce(btrim(_full_address),'') = '' THEN RAISE EXCEPTION 'Full address is required'; END IF;

  SELECT id, status, deleted_at, address_id, booking_lat, booking_lng INTO b
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF b.status IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Booking is closed; location cannot be changed'; END IF;

  IF b.address_id IS NOT NULL THEN
    SELECT full_address, area, city, pincode, latitude, longitude INTO a
      FROM public.addresses WHERE id = b.address_id;
    UPDATE public.addresses SET full_address = btrim(_full_address),
      area = NULLIF(btrim(_area),''), city = NULLIF(btrim(_city),''),
      pincode = NULLIF(btrim(_pincode),''), latitude = _lat, longitude = _lng
    WHERE id = b.address_id;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET booking_lat = _lat, booking_lng = _lng, updated_at = now() WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'change_job_location', 'bookings', _booking_id,
    jsonb_build_object('lat', b.booking_lat, 'lng', b.booking_lng, 'address', a.full_address),
    jsonb_build_object('lat', _lat, 'lng', _lng, 'address', btrim(_full_address)));
END;$$;
REVOKE ALL ON FUNCTION public.staff_set_booking_location(uuid,text,text,text,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_booking_location(uuid,text,text,text,text,double precision,double precision) TO authenticated;