DO $$
DECLARE
  kirana_id uuid := 'ed016233-40e8-483f-a664-cb6ba86bd883';
  courier_id uuid := '250ebe17-dfc8-4d9b-95ef-1f60a9372142';
  kirana_refs bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM public.services WHERE category_id = kirana_id) +
    (SELECT count(*) FROM public.service_catalogue_config WHERE service_category_id = kirana_id) +
    (SELECT count(*) FROM public.bookings WHERE service_category_id = kirana_id) +
    (SELECT count(*) FROM public.partner_skills WHERE service_category_id = kirana_id) +
    (SELECT count(*) FROM public.courier_vehicle_types WHERE required_skill = kirana_id)
  INTO kirana_refs;

  IF kirana_refs = 0 THEN
    DELETE FROM public.service_categories
    WHERE id = kirana_id
      AND name = 'Kirana & Grocery';
  ELSE
    UPDATE public.service_categories
    SET is_active = false
    WHERE id = kirana_id
      AND name = 'Kirana & Grocery';
  END IF;

  UPDATE public.service_categories
  SET is_active = false
  WHERE id = courier_id
    AND name = 'Courier Delivery';
END
$$;