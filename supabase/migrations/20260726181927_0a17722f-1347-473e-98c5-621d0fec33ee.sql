
CREATE OR REPLACE FUNCTION public.bookings_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _price numeric;
  _addr_lat numeric;
  _addr_lng numeric;
BEGIN
  SELECT price INTO _price FROM public.service_catalogue_config
   WHERE duration_minutes = NEW.service_duration_minutes AND is_active = true
   ORDER BY created_at DESC LIMIT 1;
  IF _price IS NULL THEN
    RAISE EXCEPTION 'Invalid service duration';
  END IF;
  NEW.price := _price;
  NEW.status := 'confirmed';
  NEW.rating := NULL;
  NEW.review_text := NULL;

  -- Fallback: populate booking coordinates from the address if missing
  IF (NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL) AND NEW.address_id IS NOT NULL THEN
    SELECT latitude, longitude INTO _addr_lat, _addr_lng
      FROM public.addresses WHERE id = NEW.address_id;
    IF NEW.booking_lat IS NULL THEN NEW.booking_lat := _addr_lat; END IF;
    IF NEW.booking_lng IS NULL THEN NEW.booking_lng := _addr_lng; END IF;
  END IF;

  -- Hard guard: refuse bookings with no coordinates (undispatchable)
  IF NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL THEN
    RAISE EXCEPTION 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      USING ERRCODE = 'check_violation', HINT = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  END IF;

  RETURN NEW;
END;$function$;

-- Backfill the one open booking currently missing coordinates
UPDATE public.bookings b
   SET booking_lat = a.latitude,
       booking_lng = a.longitude
  FROM public.addresses a
 WHERE b.address_id = a.id
   AND b.booking_lat IS NULL
   AND b.booking_lng IS NULL
   AND a.latitude IS NOT NULL
   AND a.longitude IS NOT NULL
   AND b.status NOT IN ('completed','cancelled','rejected');
