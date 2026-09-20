
-- 1. Staff RPC: set courier zone mapping for a city
CREATE OR REPLACE FUNCTION public.staff_courier_set_zones(_city text, _zone_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _before jsonb;
  _after jsonb;
  _key text := lower(trim(coalesce(_city, '')));
  _ids uuid[] := coalesce(_zone_ids, '{}'::uuid[]);
BEGIN
  IF NOT public.courier_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change courier settings' USING errcode = '42501';
  END IF;
  IF _key = '' THEN
    RAISE EXCEPTION 'City is required';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('zone_id', cz.zone_id, 'is_active', cz.is_active)), '[]'::jsonb)
    INTO _before
  FROM public.courier_zones cz
  JOIN public.zones z ON z.id = cz.zone_id
  WHERE lower(trim(coalesce(z.city, ''))) = _key;

  -- deactivate zones of this city that are not selected
  UPDATE public.courier_zones cz
     SET is_active = false, updated_at = now()
    FROM public.zones z
   WHERE z.id = cz.zone_id
     AND lower(trim(coalesce(z.city, ''))) = _key
     AND NOT (cz.zone_id = ANY(_ids))
     AND cz.is_active;

  -- activate / insert selected zones (must belong to this city)
  INSERT INTO public.courier_zones (zone_id, is_active)
  SELECT z.id, true
    FROM public.zones z
   WHERE z.id = ANY(_ids)
     AND lower(trim(coalesce(z.city, ''))) = _key
     AND z.deleted_at IS NULL
  ON CONFLICT (zone_id) DO UPDATE SET is_active = true, updated_at = now();

  SELECT coalesce(jsonb_agg(jsonb_build_object('zone_id', cz.zone_id, 'is_active', cz.is_active)), '[]'::jsonb)
    INTO _after
  FROM public.courier_zones cz
  JOIN public.zones z ON z.id = cz.zone_id
  WHERE lower(trim(coalesce(z.city, ''))) = _key;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'courier_set_zones', 'courier_zones', NULL,
          jsonb_build_object('city', _key, 'zones', _before),
          jsonb_build_object('city', _key, 'zones', _after));

  RETURN jsonb_build_object('ok', true, 'city', _key, 'mapped', jsonb_array_length(
    (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(_after) x WHERE (x->>'is_active')::boolean)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.staff_courier_set_zones(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_courier_set_zones(text, uuid[]) TO authenticated, service_role;

-- 2. Local (same-city, mapped-zone) route validation
CREATE OR REPLACE FUNCTION public.courier_validate_local_route(
  _city text, _pickup_lat numeric, _pickup_lng numeric, _drop_lat numeric, _drop_lng numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p jsonb; _d jsonb;
  _pcity text; _dcity text;
  _key text := lower(trim(coalesce(_city, '')));
BEGIN
  _p := public.courier_check_serviceability(_pickup_lat, _pickup_lng);
  IF NOT coalesce((_p->>'serviceable')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pickup_outside',
      'message', 'Pickup location is outside our parcel delivery area');
  END IF;

  _d := public.courier_check_serviceability(_drop_lat, _drop_lng);
  IF NOT coalesce((_d->>'serviceable')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'drop_outside',
      'message', 'Drop location is outside our parcel delivery area');
  END IF;

  SELECT lower(trim(coalesce(city, ''))) INTO _pcity FROM public.zones WHERE id = (_p->>'zone_id')::uuid;
  SELECT lower(trim(coalesce(city, ''))) INTO _dcity FROM public.zones WHERE id = (_d->>'zone_id')::uuid;

  IF _pcity IS DISTINCT FROM _dcity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'different_city',
      'message', 'We deliver parcels within the same city only');
  END IF;

  IF _key <> '' AND _key IS DISTINCT FROM _pcity THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'city_mismatch',
      'message', 'We deliver parcels within the same city only');
  END IF;

  RETURN jsonb_build_object('ok', true, 'city', _pcity,
    'pickup_zone_id', _p->>'zone_id', 'drop_zone_id', _d->>'zone_id');
END;
$$;

REVOKE ALL ON FUNCTION public.courier_validate_local_route(text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_validate_local_route(text, numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- 3. Enforce in order creation
CREATE OR REPLACE FUNCTION public.courier_create_order(_customer_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _q jsonb; _id uuid; _route jsonb;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if coalesce((_payload->>'prohibited_items_confirmed')::boolean, false) is not true then
    raise exception 'Please confirm that the parcel has no prohibited items';
  end if;

  _route := public.courier_validate_local_route(
    _payload->>'city',
    (_payload->>'pickup_lat')::numeric,
    (_payload->>'pickup_lng')::numeric,
    (_payload->>'drop_lat')::numeric,
    (_payload->>'drop_lng')::numeric
  );
  if not coalesce((_route->>'ok')::boolean, false) then
    raise exception '%', _route->>'message';
  end if;

  _q := public.courier_quote_internal(
    _customer_id,
    _payload->>'city',
    (_payload->>'vehicle_type_id')::uuid,
    (_payload->>'courier_type_id')::uuid,
    (_payload->>'distance_km')::numeric,
    coalesce((_payload->>'weight_kg')::numeric, 0),
    _payload->>'coupon_code'
  );

  insert into public.courier_orders (
    customer_id, city, vehicle_type_id, courier_type_id,
    pickup_lat, pickup_lng, pickup_address, pickup_contact_name, pickup_contact_phone,
    drop_lat, drop_lng, drop_address, drop_contact_name, drop_contact_phone,
    package_description, weight_kg, prohibited_items_confirmed,
    distance_km, distance_source, fare_breakdown, quote_expires_at,
    base_amount, extra_fee, platform_fee, discount_amount, coupon_id, coupon_code,
    gst_percent, gst_amount, total_amount, commission_pct, status
  ) values (
    _customer_id, _payload->>'city', (_payload->>'vehicle_type_id')::uuid, (_payload->>'courier_type_id')::uuid,
    (_payload->>'pickup_lat')::numeric, (_payload->>'pickup_lng')::numeric, _payload->>'pickup_address',
    _payload->>'pickup_contact_name', _payload->>'pickup_contact_phone',
    (_payload->>'drop_lat')::numeric, (_payload->>'drop_lng')::numeric, _payload->>'drop_address',
    _payload->>'drop_contact_name', _payload->>'drop_contact_phone',
    _payload->>'package_description', coalesce((_payload->>'weight_kg')::numeric,0), true,
    (_q->>'distance_km')::numeric, coalesce(_payload->>'distance_source','routes'), _q,
    (_q->>'quote_expires_at')::timestamptz,
    (_q->>'base_amount')::numeric, (_q->>'extra_fee')::numeric, (_q->>'platform_fee')::numeric,
    (_q->>'discount_amount')::numeric, nullif(_q->>'coupon_id','')::uuid, _q->>'coupon_code',
    (_q->>'gst_percent')::numeric, (_q->>'gst_amount')::numeric, (_q->>'total_amount')::numeric,
    (_q->>'commission_pct')::numeric, 'REQUESTED'
  ) returning id into _id;

  return jsonb_build_object('ok', true, 'order_id', _id, 'quote', _q);
end $function$;
