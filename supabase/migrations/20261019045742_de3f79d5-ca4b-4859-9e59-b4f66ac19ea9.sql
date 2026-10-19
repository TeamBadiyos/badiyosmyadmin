CREATE OR REPLACE FUNCTION public.staff_list_cities() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'state_code',c.state_code,'status',c.status,'is_default',c.is_default,
    'zones',(SELECT count(*) FROM zones z WHERE z.city_id=c.id AND z.deleted_at IS NULL),
    'live_services',(SELECT count(*) FROM service_flags f WHERE f.city_id=c.id AND f.status='live'),
    'merchants',(SELECT count(*) FROM merchants m WHERE m.city_id=c.id AND m.deleted_at IS NULL AND m.status='approved'),
    'merchants_total',(SELECT count(*) FROM merchants m WHERE m.city_id=c.id AND m.deleted_at IS NULL),
    'experts',(SELECT count(*) FROM experts e WHERE e.city_id=c.id AND e.status='active'),
    'experts_total',(SELECT count(*) FROM experts e WHERE e.city_id=c.id),
    'bookings',(SELECT count(*) FROM bookings b WHERE b.city_id=c.id),
    'orders',(SELECT count(*) FROM merchant_orders o WHERE o.city_id=c.id)+(SELECT count(*) FROM courier_orders o WHERE o.city_id=c.id)
  ) ORDER BY c.is_default DESC, c.name) FROM cities c), '[]'::jsonb);
END $$;