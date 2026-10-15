ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_number text;
CREATE SEQUENCE IF NOT EXISTS public.booking_no_ch_seq START 10001;
CREATE SEQUENCE IF NOT EXISTS public.booking_no_ca_seq START 10001;

SELECT set_config('app.booking_bypass','on', true);
WITH o AS (
  SELECT id, CASE WHEN public.booking_capacity_group(service_category_id, service_label)='wash' THEN 'CA' ELSE 'CH' END p,
         row_number() OVER (PARTITION BY CASE WHEN public.booking_capacity_group(service_category_id, service_label)='wash' THEN 'CA' ELSE 'CH' END ORDER BY created_at, id) n
  FROM public.bookings WHERE booking_number IS NULL)
UPDATE public.bookings b SET booking_number = o.p || '-' || (10000 + o.n) FROM o WHERE o.id=b.id;

SELECT setval('public.booking_no_ch_seq', greatest(10001, coalesce((SELECT max(substr(booking_number,4)::int) FROM public.bookings WHERE booking_number LIKE 'CH-%'),10000)+1), false);
SELECT setval('public.booking_no_ca_seq', greatest(10001, coalesce((SELECT max(substr(booking_number,4)::int) FROM public.bookings WHERE booking_number LIKE 'CA-%'),10000)+1), false);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_booking_number_key ON public.bookings(booking_number);

CREATE OR REPLACE FUNCTION public.bookings_assign_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.booking_number IS NULL THEN
    IF public.booking_capacity_group(NEW.service_category_id, NEW.service_label)='wash'
      THEN NEW.booking_number := 'CA-' || nextval('public.booking_no_ca_seq');
      ELSE NEW.booking_number := 'CH-' || nextval('public.booking_no_ch_seq'); END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bookings_assign_number() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bookings_assign_number ON public.bookings;
CREATE TRIGGER trg_bookings_assign_number BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_assign_number();

UPDATE public.customer_invoices i SET ref_code=b.booking_number FROM public.bookings b WHERE i.ref_type='booking' AND i.ref_id=b.id;

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.fin_issue_invoice(text,uuid,date)'::regprocedure);
  IF position('_code:=left(b.id::text,8)' in d)=0 THEN RAISE EXCEPTION 'patch target missing'; END IF;
  d := replace(d, '_code:=left(b.id::text,8)', '_code:=coalesce(b.booking_number,left(b.id::text,8))');
  EXECUTE d;
END $$;