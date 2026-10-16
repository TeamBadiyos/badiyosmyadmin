ALTER TABLE public.city_service_settings
  ADD COLUMN IF NOT EXISTS delivery_base_fare numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_included_km numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_platform_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rider_share_pct numeric;

UPDATE public.city_service_settings c SET delivery_base_fare = 30, delivery_included_km = 2, delivery_per_km = 10,
  delivery_min_fare = 30, delivery_platform_fee = 0,
  rider_share_pct = (SELECT rider_share_pct FROM public.service_settings s WHERE s.service_key = c.service_key)
FROM public.cities ci WHERE ci.id = c.city_id AND ci.name ILIKE 'latur%' AND c.service_key IN ('store','food');

CREATE OR REPLACE FUNCTION public.delivery_fee_calc(_km numeric, _base numeric, _incl numeric, _per_km numeric, _min numeric, _pf numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT round(greatest(coalesce(_min,0), coalesce(_base,0) + greatest(0, coalesce(_km,0) - coalesce(_incl,0)) * coalesce(_per_km,0)) + coalesce(_pf,0), 2)
$$;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.order_bill_core(uuid,jsonb,numeric,numeric)'::regprocedure);
  d := replace(d, 'coalesce(c.delivery_per_km, s.delivery_per_km) as delivery_per_km, s.rider_share_pct,',
    'coalesce(c.delivery_per_km, s.delivery_per_km) as delivery_per_km, coalesce(c.delivery_base_fare,0) as delivery_base_fare, coalesce(c.delivery_included_km,0) as delivery_included_km, coalesce(c.delivery_platform_fee,0) as delivery_platform_fee, coalesce(c.rider_share_pct, s.rider_share_pct) as rider_share_pct,');
  d := replace(d, '_fee := round(greatest(coalesce(_ss.delivery_min_fare,0), _km * coalesce(_ss.delivery_per_km,0)), 2);',
    '_fee := public.delivery_fee_calc(_km, _ss.delivery_base_fare, _ss.delivery_included_km, _ss.delivery_per_km, _ss.delivery_min_fare, _ss.delivery_platform_fee);');
  IF position('delivery_fee_calc' in d) = 0 OR position('delivery_base_fare' in d) = 0 THEN RAISE EXCEPTION 'order_bill_core patch failed'; END IF;
  EXECUTE d;
END $do$;

CREATE OR REPLACE FUNCTION public.staff_set_city_service(_city_id uuid, _service_key text, _patch jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _before jsonb;
BEGIN
  IF NOT public.staff_can_city(_city_id) OR NOT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id = auth.uid() AND status = 'active' AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Not allowed for this city';
  END IF;
  SELECT to_jsonb(s) INTO _before FROM city_service_settings s WHERE city_id=_city_id AND service_key=_service_key;
  INSERT INTO city_service_settings (city_id, service_key) VALUES (_city_id, _service_key) ON CONFLICT DO NOTHING;
  UPDATE city_service_settings SET
    delivery_min_fare = coalesce((_patch->>'delivery_min_fare')::numeric, delivery_min_fare),
    delivery_per_km = coalesce((_patch->>'delivery_per_km')::numeric, delivery_per_km),
    delivery_base_fare = coalesce((_patch->>'delivery_base_fare')::numeric, delivery_base_fare),
    delivery_included_km = coalesce((_patch->>'delivery_included_km')::numeric, delivery_included_km),
    delivery_platform_fee = coalesce((_patch->>'delivery_platform_fee')::numeric, delivery_platform_fee),
    rider_share_pct = coalesce((_patch->>'rider_share_pct')::numeric, rider_share_pct),
    default_accept_timeout_minutes = coalesce((_patch->>'default_accept_timeout_minutes')::int, default_accept_timeout_minutes),
    updated_at = now()
  WHERE city_id=_city_id AND service_key=_service_key;
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'city_service_update', 'city_service_settings', _city_id, _before, _patch || jsonb_build_object('service_key', _service_key));
END $function$;