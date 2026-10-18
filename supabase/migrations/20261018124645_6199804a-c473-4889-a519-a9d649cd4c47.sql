create or replace function public.zv2_nearest_live_zone(_lat double precision, _lng double precision) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select z.id from zones z
   where z.deleted_at is null and z.status='active' and z.geom is not null
   order by extensions.ST_Distance(z.geom, extensions.ST_SetSRID(extensions.ST_MakePoint(_lng,_lat),4326)) limit 1
$$;
revoke all on function public.zv2_nearest_live_zone(double precision,double precision) from public, anon, authenticated;

select set_config('app.booking_bypass','on',true);

update public.bookings b set zone_id = public.zv2_nearest_live_zone(b.booking_lat::float8, b.booking_lng::float8)
 where b.booking_lat is not null and b.booking_lng is not null
   and b.zone_id is distinct from public.zv2_nearest_live_zone(b.booking_lat::float8, b.booking_lng::float8);

update public.bookings set partner_payout_batch_id = null
 where partner_payout_batch_id is not null
   and partner_payout_batch_id not in (select id from public.partner_payout_batches where status <> 'deleted');

update public.courier_orders c set zone_id = public.zv2_nearest_live_zone(c.pickup_lat::float8, c.pickup_lng::float8)
 where c.pickup_lat is not null and c.pickup_lng is not null
   and c.zone_id is distinct from public.zv2_nearest_live_zone(c.pickup_lat::float8, c.pickup_lng::float8);

update public.merchants m set zone_id = public.zv2_nearest_live_zone(m.latitude::float8, m.longitude::float8)
 where m.latitude is not null and m.longitude is not null
   and m.zone_id is distinct from public.zv2_nearest_live_zone(m.latitude::float8, m.longitude::float8);

select set_config('app.booking_bypass','off',true);