DROP FUNCTION IF EXISTS public.gift_delete_test_data(uuid);

CREATE OR REPLACE FUNCTION public.gift_zone_at(_lat double precision, _lng double precision, _city uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  select z.id from zones z
  where z.deleted_at is null and coalesce(z.is_active, true) and z.geom is not null
    and (_city is null or z.city_id = _city)
    and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(_lng, _lat), 4326))
  order by z.name limit 1 $$;
REVOKE ALL ON FUNCTION public.gift_zone_at(double precision, double precision, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gift_client_zones(_merchant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _city uuid;
begin
  if not public.gift_can(_merchant) then raise exception 'Forbidden'; end if;
  select city_id into _city from merchants where id = _merchant;
  return jsonb_build_object(
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name) order by z.name)
       from zones z where z.city_id = _city and z.deleted_at is null and coalesce(z.is_active, true)), '[]'::jsonb),
    'addresses', coalesce((select jsonb_object_agg(a.id, public.gift_zone_at(a.lat, a.lng, _city))
       from gift_client_addresses a where a.merchant_id = _merchant and a.lat is not null), '{}'::jsonb));
end $$;
REVOKE ALL ON FUNCTION public.gift_client_zones(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_client_zones(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.gift_customer_pool(_merchant uuid, _q text, _zone uuid, _limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _city uuid; _qq text := nullif(trim(coalesce(_q, '')), ''); _d text;
begin
  if not public.gift_can(_merchant) then raise exception 'Forbidden'; end if;
  select city_id into _city from merchants where id = _merchant;
  _d := nullif(regexp_replace(coalesce(_qq, ''), '\D', '', 'g'), '');
  return (
    with u as (
      select us.id, coalesce(nullif(us.full_name, ''), 'Customer') name, us.phone
      from users us
      where us.deleted_at is null and us.phone is not null
        and (_qq is null or us.full_name ilike '%' || _qq || '%' or (_d is not null and length(_d) >= 3 and us.phone like '%' || _d || '%'))
        and not exists (select 1 from gift_clients g where g.merchant_id = _merchant and right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(us.phone, '\D', '', 'g'), 10))
    ), ad as (
      select a.user_id, a.id, coalesce(a.label, 'Address') label, a.full_address address, a.latitude lat, a.longitude lng, coalesce(a.is_default, false) is_default,
             public.gift_zone_at(a.latitude, a.longitude, _city) zone_id
      from addresses a join u on u.id = a.user_id
      where a.latitude is not null and a.longitude is not null
    ), pick as (
      select u.id, u.name, u.phone,
        (select jsonb_agg(jsonb_build_object('label', ad.label, 'address', ad.address, 'lat', ad.lat, 'lng', ad.lng, 'is_default', ad.is_default, 'zone_id', ad.zone_id) order by ad.is_default desc)
           from ad where ad.user_id = u.id) addrs,
        (select ad.zone_id from ad where ad.user_id = u.id order by ad.is_default desc limit 1) zone_id
      from u
    )
    select jsonb_build_object(
      'customers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'zone_id', zone_id, 'addresses', addrs) order by name)
         from (select * from pick where addrs is not null and (_zone is null or zone_id = _zone) order by name limit greatest(1, least(coalesce(_limit, 50), 5000))) x), '[]'::jsonb),
      'total', (select count(*) from pick where addrs is not null and (_zone is null or zone_id = _zone)),
      'no_pin', (select count(*) from pick where addrs is null))
  );
end $$;
REVOKE ALL ON FUNCTION public.gift_customer_pool(uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gift_customer_pool(uuid, text, uuid, integer) TO authenticated;