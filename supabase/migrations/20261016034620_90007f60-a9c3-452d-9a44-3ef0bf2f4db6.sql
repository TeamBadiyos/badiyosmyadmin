DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.order_bill_core'::regproc);
  d := replace(d, 'select * into _ss from public.service_settings where service_key = _svc;',
    'select s.service_key, coalesce(c.delivery_min_fare, s.delivery_min_fare) as delivery_min_fare, coalesce(c.delivery_per_km, s.delivery_per_km) as delivery_per_km, s.rider_share_pct, coalesce(c.default_accept_timeout_minutes, s.default_accept_timeout_minutes) as default_accept_timeout_minutes into _ss from public.service_settings s left join public.city_service_settings c on c.service_key = s.service_key and c.city_id = coalesce(_m.city_id, public.default_city_id()) where s.service_key = _svc;');
  d := replace(d, 'from public.fee_rules where is_active and _svc = any(service_types)',
    'from public.fee_rules where is_active and _svc = any(service_types) and (city_id is null or city_id = coalesce(_m.city_id, public.default_city_id()))');
  IF position('city_service_settings' in d) = 0 OR position('city_id is null' in d) = 0 THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE d;
END $$;