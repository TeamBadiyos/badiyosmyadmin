
create table public.gift_clients (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  city_id uuid references public.cities(id),
  name text not null, phone text, company text, notes text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.gift_client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.gift_clients(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  label text not null default 'Home', address text not null,
  lat double precision not null, lng double precision not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.gift_campaigns (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  city_id uuid references public.cities(id),
  name text not null, occasion text,
  pickup_name text, pickup_address text, pickup_lat double precision, pickup_lng double precision,
  pickup_contact text, pickup_date date,
  max_drops_per_trip integer not null default 12,
  status text not null default 'draft',
  is_test boolean not null default false, notes text,
  created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.gift_trips (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.gift_campaigns(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  trip_no integer not null, zone_id uuid, zone_name text,
  distance_km numeric, route_source text not null default 'nearest_next',
  status text not null default 'planned',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.gift_drops (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.gift_campaigns(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  client_id uuid references public.gift_clients(id) on delete set null,
  address_id uuid references public.gift_client_addresses(id) on delete set null,
  recipient_name text not null, recipient_phone text,
  address text not null, lat double precision not null, lng double precision not null,
  zone_id uuid, zone_name text,
  gift_note text, packet_count integer not null default 1,
  trip_id uuid references public.gift_trips(id) on delete set null,
  stop_seq integer, status text not null default 'pending',
  is_test boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index on public.gift_drops(campaign_id); create index on public.gift_drops(trip_id);
create index on public.gift_trips(campaign_id); create index on public.gift_client_addresses(client_id);

grant select, insert, update, delete on public.gift_clients, public.gift_client_addresses, public.gift_campaigns, public.gift_trips, public.gift_drops to authenticated;
grant all on public.gift_clients, public.gift_client_addresses, public.gift_campaigns, public.gift_trips, public.gift_drops to service_role;
grant select on public.gift_clients, public.gift_client_addresses, public.gift_campaigns, public.gift_trips, public.gift_drops to cc_reader;

create or replace function public.gift_can(_merchant uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select coalesce(public.courier_is_ops_staff(),false) or public.current_merchant_id() = _merchant $$;
revoke all on function public.gift_can(uuid) from public, anon; grant execute on function public.gift_can(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['gift_clients','gift_client_addresses','gift_campaigns','gift_trips','gift_drops'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "gift owner or ops" on public.%I for all to authenticated using (public.gift_can(merchant_id)) with check (public.gift_can(merchant_id))', t);
    execute format('create policy cc_reader_all on public.%I for select to cc_reader using (true)', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()', t||'_touch', t);
  end loop; end $$;
create policy cc_city_scope on public.gift_campaigns as restrictive for all to public
  using ((city_id is null) or ((select cc_visible_cities()) is null) or (city_id = any((select cc_visible_cities())::uuid[])));
create policy cc_city_scope on public.gift_clients as restrictive for all to public
  using ((city_id is null) or ((select cc_visible_cities()) is null) or (city_id = any((select cc_visible_cities())::uuid[])));
create trigger a00_phone_std before insert or update on public.gift_clients for each row execute function public.trg_phone_std('phone');
create trigger a00_phone_std before insert or update on public.gift_drops for each row execute function public.trg_phone_std('recipient_phone');

-- straight-line distance (km)
create or replace function public.gift_km(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians(b_lat-a_lat)/2),2) + cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lng-a_lng)/2),2))) $$;

-- ROUTING: single swap point (nearest-next today; Google Route Optimization later)
create or replace function public.gift_route_order(_from_lat double precision, _from_lng double precision, _drop_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare rem uuid[] := _drop_ids; res uuid[] := '{}'; cl double precision := _from_lat; cg double precision := _from_lng; nxt record;
begin
  while coalesce(array_length(rem,1),0) > 0 loop
    select id, lat, lng into nxt from gift_drops where id = any(rem)
      order by public.gift_km(cl, cg, lat, lng), id limit 1;
    res := res || nxt.id; rem := array_remove(rem, nxt.id); cl := nxt.lat; cg := nxt.lng;
  end loop;
  return res;
end $$;

create or replace function public.gift_trip_recalc(_trip uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c record; d record; pl double precision; pg double precision; km double precision := 0;
begin
  select g.pickup_lat, g.pickup_lng into c from gift_trips t join gift_campaigns g on g.id=t.campaign_id where t.id=_trip;
  pl := c.pickup_lat; pg := c.pickup_lng;
  for d in select lat, lng from gift_drops where trip_id=_trip order by stop_seq loop
    if pl is not null then km := km + public.gift_km(pl,pg,d.lat,d.lng); end if; pl := d.lat; pg := d.lng;
  end loop;
  update gift_trips set distance_km = round(km::numeric,2) where id=_trip;
end $$;

create or replace function public.gift_require_campaign(_campaign uuid) returns public.gift_campaigns
language plpgsql security definer set search_path=public as $$
declare c gift_campaigns; begin
  select * into c from gift_campaigns where id=_campaign;
  if c.id is null then raise exception 'Campaign not found'; end if;
  if not public.gift_can(c.merchant_id) then raise exception 'Forbidden'; end if;
  return c; end $$;

create or replace function public.gift_plan_trips(_campaign uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c gift_campaigns; z record; ids uuid[]; ordered uuid[]; n int := 0; i int; cap int; tid uuid; zl jsonb; d record;
begin
  c := public.gift_require_campaign(_campaign);
  if c.pickup_lat is null then raise exception 'Set the pickup point first'; end if;
  if exists (select 1 from gift_trips where campaign_id=_campaign and status<>'planned') then
    raise exception 'Some trips are already dispatched; re-planning is blocked'; end if;
  cap := greatest(coalesce(c.max_drops_per_trip,12),1);
  for d in select id, lat, lng from gift_drops where campaign_id=_campaign loop
    begin zl := public.zone_lookup(d.lat, d.lng); exception when others then zl := '{}'; end;
    update gift_drops set zone_id = nullif(zl->>'zone_id','')::uuid, zone_name = coalesce(zl->>'zone','Outside zones'),
      trip_id = null, stop_seq = null, status = 'pending' where id=d.id;
  end loop;
  delete from gift_trips where campaign_id=_campaign;
  for z in select zone_id, zone_name, array_agg(id) a from gift_drops where campaign_id=_campaign
           group by zone_id, zone_name order by zone_name loop
    ordered := public.gift_route_order(c.pickup_lat, c.pickup_lng, z.a);
    i := 1;
    while i <= array_length(ordered,1) loop
      n := n + 1;
      insert into gift_trips(campaign_id, merchant_id, trip_no, zone_id, zone_name)
        values (_campaign, c.merchant_id, n, z.zone_id, z.zone_name) returning id into tid;
      ids := ordered[i : least(i+cap-1, array_length(ordered,1))];
      update gift_drops g set trip_id=tid, stop_seq=s.ord, status='planned'
        from unnest(ids) with ordinality s(id, ord) where g.id=s.id;
      perform public.gift_trip_recalc(tid);
      i := i + cap;
    end loop;
  end loop;
  update gift_campaigns set status = case when n>0 then 'planned' else 'draft' end where id=_campaign;
  perform public.business_audit('gift_plan_trips','gift_campaigns',_campaign,null,jsonb_build_object('trips',n),null);
  return jsonb_build_object('trips', n);
end $$;

create or replace function public.gift_set_trip_order(_trip uuid, _drop_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare t gift_trips; c gift_campaigns; begin
  select * into t from gift_trips where id=_trip for update;
  if t.id is null then raise exception 'Trip not found'; end if;
  c := public.gift_require_campaign(t.campaign_id);
  if t.status<>'planned' then raise exception 'Trip already dispatched'; end if;
  if exists (select 1 from unnest(_drop_ids) x left join gift_drops g on g.id=x where g.id is null or g.campaign_id<>t.campaign_id) then
    raise exception 'Drop does not belong to this campaign'; end if;
  if exists (select 1 from gift_drops g join gift_trips o on o.id=g.trip_id where g.id = any(_drop_ids) and o.status<>'planned') then
    raise exception 'Cannot move a drop out of a dispatched trip'; end if;
  update gift_drops g set trip_id=_trip, stop_seq=s.ord, status='planned'
    from unnest(_drop_ids) with ordinality s(id, ord) where g.id=s.id;
  update gift_drops set trip_id=null, stop_seq=null, status='pending' where trip_id=_trip and not (id = any(_drop_ids));
  perform public.gift_trip_recalc(_trip);
  perform public.gift_trip_recalc(x.trip_id) from (select distinct trip_id from gift_trips tt join gift_drops gd on gd.trip_id=tt.id where tt.campaign_id=t.campaign_id) x;
  delete from gift_trips tr where tr.campaign_id=t.campaign_id and tr.status='planned' and not exists (select 1 from gift_drops where trip_id=tr.id) and tr.id<>_trip;
  perform public.business_audit('gift_set_trip_order','gift_trips',_trip,null,to_jsonb(_drop_ids),null);
end $$;

create or replace function public.gift_move_drop(_drop uuid, _to_trip uuid) returns void
language plpgsql security definer set search_path=public as $$
declare d gift_drops; t gift_trips; old uuid; ids uuid[]; begin
  select * into d from gift_drops where id=_drop;
  if d.id is null then raise exception 'Drop not found'; end if;
  select * into t from gift_trips where id=_to_trip;
  if t.id is null or t.campaign_id<>d.campaign_id then raise exception 'Trip not in this campaign'; end if;
  old := d.trip_id;
  select coalesce(array_agg(id order by stop_seq),'{}') || _drop into ids from gift_drops where trip_id=_to_trip and id<>_drop;
  perform public.gift_set_trip_order(_to_trip, ids);
  if old is not null and old<>_to_trip then
    with s as (select id, row_number() over (order by stop_seq) r from gift_drops where trip_id=old)
      update gift_drops g set stop_seq=s.r from s where g.id=s.id;
    perform public.gift_trip_recalc(old);
    delete from gift_trips tr where tr.id=old and tr.status='planned' and not exists (select 1 from gift_drops where trip_id=old);
  end if;
end $$;

create or replace function public.gift_delete_test_data(_campaign uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c gift_campaigns; nd int; nc int; begin
  c := public.gift_require_campaign(_campaign);
  delete from gift_drops where campaign_id=_campaign and is_test; get diagnostics nd = row_count;
  delete from gift_trips tr where campaign_id=_campaign and not exists (select 1 from gift_drops where trip_id=tr.id);
  delete from gift_clients gc where gc.merchant_id=c.merchant_id and gc.is_test
    and not exists (select 1 from gift_drops where client_id=gc.id); get diagnostics nc = row_count;
  if c.is_test and not exists (select 1 from gift_drops where campaign_id=_campaign) then
    delete from gift_campaigns where id=_campaign; end if;
  perform public.business_audit('gift_delete_test_data','gift_campaigns',_campaign,null,jsonb_build_object('drops',nd,'clients',nc),null);
  return jsonb_build_object('drops', nd, 'clients', nc, 'campaign_deleted', c.is_test and not exists (select 1 from gift_campaigns where id=_campaign));
end $$;

-- block rider dispatch for test trips
create or replace function public.gift_trips_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if new.status<>'planned' and old.status='planned' and exists (select 1 from gift_drops where trip_id=new.id and is_test) then
    raise exception 'Test trips can never be dispatched to riders'; end if;
  return new; end $$;
create trigger gift_trips_guard before update on public.gift_trips for each row execute function public.gift_trips_guard();

do $$ declare f text; begin
  foreach f in array array['gift_route_order(double precision,double precision,uuid[])','gift_trip_recalc(uuid)','gift_require_campaign(uuid)','gift_plan_trips(uuid)','gift_set_trip_order(uuid,uuid[])','gift_move_drop(uuid,uuid)','gift_delete_test_data(uuid)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;

-- Growth Story Company on the existing merchant login + 25 TEST drops
do $$
declare _auth uuid := '1cbf121b-5855-47cc-84ad-d4c1069e0a98'; _city uuid := 'a689c0f7-8356-4848-ae4a-af73ab52d041';
  _mid uuid; _camp uuid; _cl uuid; _ad uuid; p record; i int := 0; plat double precision; plng double precision;
  names text[] := array['Amit','Priya','Rahul','Sneha','Vikas','Neha','Sagar','Pooja','Rohit','Kavita','Nikhil','Anjali','Suresh','Meera','Akash','Swati','Manoj','Komal','Ajay','Divya','Prakash','Ritu','Sanjay','Asha','Kiran'];
begin
  select id into _mid from merchants where auth_user_id=_auth limit 1;
  if _mid is null then
    select id into _mid from merchants where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)='8698340766' limit 1;
  end if;
  if _mid is null then
    insert into merchants(phone, store_name, city, status, onboarding_step, store_enabled, delivery_enabled, delivery_status, auth_user_id)
    values ('8698340766','Growth Story Company','Latur','draft',1,false,true,'active',_auth) returning id into _mid;
  else
    update merchants set delivery_enabled=true, delivery_status='active', auth_user_id=coalesce(auth_user_id,_auth) where id=_mid;
  end if;
  insert into business_profiles(merchant_id, business_name, city) values (_mid,'Growth Story Company','Latur')
    on conflict (merchant_id) do update set business_name=excluded.business_name;

  select ST_Y(c), ST_X(c) into plat, plng from (select ST_Centroid(geom) c from city_boundaries where city_id=_city limit 1) q;
  insert into gift_campaigns(merchant_id, city_id, name, occasion, pickup_name, pickup_address, pickup_lat, pickup_lng, pickup_date, is_test, notes)
  values (_mid,_city,'TEST – Diwali Gifting 2026','Diwali','Growth Story Company office','Latur (test pickup – edit before going live)',plat,plng,
          (now() at time zone 'Asia/Kolkata')::date + 3, true, 'Test campaign – never dispatched to riders')
  returning id into _camp;

  for p in
    select z.name zname, ST_Y(pt) lat, ST_X(pt) lng from zones z,
      lateral (select (ST_Dump(ST_GeneratePoints(z.geom, 3, 42))).geom pt) g
    where z.city_id=_city and z.deleted_at is null and z.status='active' and z.geom is not null
    order by z.name limit 25
  loop
    i := i + 1;
    insert into gift_clients(merchant_id, city_id, name, phone, company, is_test)
      values (_mid,_city,'TEST – '||names[i], '90000000'||lpad(i::text,2,'0'), 'Test client', true) returning id into _cl;
    insert into gift_client_addresses(client_id, merchant_id, label, address, lat, lng, is_default)
      values (_cl,_mid,'Office','Test address '||i||', '||p.zname||', Latur',p.lat,p.lng,true) returning id into _ad;
    insert into gift_drops(campaign_id, merchant_id, client_id, address_id, recipient_name, recipient_phone, address, lat, lng, gift_note, is_test)
      values (_camp,_mid,_cl,_ad,'TEST – '||names[i],'90000000'||lpad(i::text,2,'0'),'Test address '||i||', '||p.zname||', Latur',p.lat,p.lng,'Diwali hamper',true);
  end loop;
end $$;
