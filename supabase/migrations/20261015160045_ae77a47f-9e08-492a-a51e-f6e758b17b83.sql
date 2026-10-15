DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.bookings_before_insert'::regproc);
  d := replace(d, 'NEW.service_label := coalesce(NEW.service_label, _spo.label);', 'NEW.service_label := _spo.label;');
  EXECUTE d;
END $m$;

SELECT set_config('app.booking_bypass', 'on', true);
UPDATE public.bookings b
   SET service_label = spo.label
  FROM public.service_price_options spo
 WHERE spo.id = b.price_option_id
   AND b.service_label IS DISTINCT FROM spo.label
   AND b.status NOT IN ('completed','cancelled')
   AND b.scheduled_date >= current_date;