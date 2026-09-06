CREATE OR REPLACE FUNCTION public.bookings_auto_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _lat numeric;
  _lng numeric;
  _zone uuid;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NULL; END IF;
  IF NEW.assigned_expert_id IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.razorpay_payment_id IS NULL OR length(NEW.razorpay_payment_id) = 0 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.razorpay_payment_id IS NOT DISTINCT FROM NEW.razorpay_payment_id
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NULL;
  END IF;

  _lat := NEW.booking_lat;
  _lng := NEW.booking_lng;
  IF (_lat IS NULL OR _lng IS NULL) AND NEW.address_id IS NOT NULL THEN
    SELECT latitude, longitude INTO _lat, _lng FROM public.addresses WHERE id = NEW.address_id;
  END IF;
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    _zone := public.resolve_zone_for_point(_lat, _lng);
  END IF;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET status = 'accepted',
         zone_id = COALESCE(_zone, zone_id)
   WHERE id = NEW.id AND status = 'confirmed';
  PERFORM set_config('app.booking_bypass', 'off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (COALESCE(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
          'auto_dispatch_on_payment', 'bookings', NEW.id, NULL,
          jsonb_build_object('actor_role','system','razorpay_payment_id', NEW.razorpay_payment_id));

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bookings_auto_dispatch ON public.bookings;
CREATE TRIGGER trg_bookings_auto_dispatch
AFTER INSERT OR UPDATE OF status, razorpay_payment_id ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_auto_dispatch();