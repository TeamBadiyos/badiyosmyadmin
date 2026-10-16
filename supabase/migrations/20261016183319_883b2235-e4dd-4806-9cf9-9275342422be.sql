create extension if not exists postgis with schema extensions;

alter table public.zones add column if not exists geom extensions.geometry(MultiPolygon,4326),
  add column if not exists colour text, add column if not exists version int not null default 1;

create table public.city_boundaries (
  city_id uuid primary key references public.cities(id) on delete cascade,
  geom extensions.geometry(MultiPolygon,4326) not null,
  source text not null default 'manual',
  saved_by uuid, updated_at timestamptz not null default now());
create table public.zone_draft_cells (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  name text not null, colour text not null default '#00B97A',
  geom extensions.geometry(MultiPolygon,4326) not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.zone_draft_history (
  id bigserial primary key, city_id uuid not null references public.cities(id) on delete cascade,
  op text not null, snapshot jsonb not null, actor uuid, created_at timestamptz not null default now());

grant select on public.city_boundaries, public.zone_draft_cells, public.zone_draft_history to authenticated;
grant all on public.city_boundaries, public.zone_draft_cells, public.zone_draft_history to service_role;
alter table public.city_boundaries enable row level security;
alter table public.zone_draft_cells enable row level security;
alter table public.zone_draft_history enable row level security;
do $$ declare t text; begin
  foreach t in array array['city_boundaries','zone_draft_cells','zone_draft_history'] loop
    execute format('create policy "staff read" on public.%I for select to authenticated using (exists (select 1 from public.staff_users s where s.auth_user_id = auth.uid() and s.status=''active'' and s.role in (''super_admin'',''ops_manager'')))', t);
    execute format('create policy cc_city_scope on public.%I as restrictive for select to authenticated using (city_id = any(public.staff_allowed_city_ids()))', t);
    if exists (select 1 from pg_roles where rolname='cc_reader') then
      execute format('grant select on public.%I to cc_reader', t);
      execute format('create policy cc_reader_all on public.%I for select to cc_reader using (true)', t);
    end if;
  end loop; end $$;

-- helpers
create or replace function public.zv2_from_jsonb(_b jsonb) returns extensions.geometry
language plpgsql immutable set search_path = public, extensions as $$
declare pts text; begin
  if _b is null or jsonb_typeof(_b)<>'array' or jsonb_array_length(_b)<3 then return null; end if;
  select string_agg((p->>'lng')||' '||(p->>'lat'), ',' order by o) into pts from jsonb_array_elements(_b) with ordinality e(p,o);
  pts := pts || ',' || (_b->0->>'lng')||' '||(_b->0->>'lat');
  return ST_Multi(ST_MakeValid(ST_GeomFromText('POLYGON(('||pts||'))',4326)));
exception when others then return null; end $$;

create or replace function public.zv2_to_jsonb(_g extensions.geometry) returns jsonb
language sql immutable set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('lat',ST_Y(d.geom),'lng',ST_X(d.geom)) order by d.path[1]), '[]'::jsonb)
  from (select (ST_DumpPoints(ST_ExteriorRing(p.geom))).* from
    (select (ST_Dump(_g)).geom order by ST_Area((ST_Dump(_g)).geom) desc limit 1) p) d
  where d.path[1] < ST_NPoints(ST_ExteriorRing((select (ST_Dump(_g)).geom order by ST_Area((ST_Dump(_g)).geom) desc limit 1)))
$$;

create or replace function public.zv2_clean(_g extensions.geometry) returns extensions.geometry
language sql immutable set search_path = public, extensions as $$
  select ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SnapToGrid(_g, 0.0000001)),3)) $$;

-- legacy mirror + backfill
create or replace function public.zv2_zone_mirror() returns trigger language plpgsql set search_path = public, extensions as $$
begin
  if tg_op='INSERT' or new.geom is distinct from old.geom then
    if new.geom is not null then new.boundary := public.zv2_to_jsonb(new.geom);
    elsif new.boundary is not null then new.geom := public.zv2_from_jsonb(new.boundary); end if;
  elsif new.boundary is distinct from old.boundary then new.geom := public.zv2_from_jsonb(new.boundary);
  end if; return new; end $$;
create trigger zv2_zone_mirror before insert or update on public.zones for each row execute function public.zv2_zone_mirror();
update public.zones set geom = public.zv2_from_jsonb(boundary) where geom is null;
create index if not exists zones_geom_gix on public.zones using gist (geom);
create index if not exists city_boundaries_gix on public.city_boundaries using gist (geom);

create or replace function public.zv2_require(_city uuid, _super boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r text; begin
  select role into r from staff_users where auth_user_id = auth.uid() and status='active';
  if r is null or r not in ('super_admin','ops_manager') or (_super and r<>'super_admin') then raise exception 'Forbidden'; end if;
  if not (_city = any(staff_allowed_city_ids())) then raise exception 'Forbidden for this city'; end if;
end $$;

create or replace function public.zv2_snapshot(_city uuid, _op text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into zone_draft_history(city_id, op, actor, snapshot)
  select _city, _op, auth.uid(), coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'colour',colour,'geom',ST_AsGeoJSON(geom)::jsonb)),'[]')
  from zone_draft_cells where city_id=_city;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'zones_v2_'||_op, 'zone_draft_cells', _city, null, jsonb_build_object('op',_op));
end $$;

-- slivers (<2000 m2) merge into neighbour sharing the longest border
create or replace function public.zv2_normalize(_city uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare p record; nb uuid; n int := 0; begin
  for p in select c.id, d.geom from zone_draft_cells c, ST_Dump(c.geom) d
    where c.city_id=_city and ST_Area(d.geom::geography) < 2000 loop
    select o.id into nb from zone_draft_cells o where o.city_id=_city and o.id<>p.id and ST_Intersects(o.geom, p.geom)
      order by ST_Length(ST_Intersection(ST_Boundary(o.geom), ST_Boundary(p.geom))::geography) desc limit 1;
    if nb is null then continue; end if;
    update zone_draft_cells set geom = zv2_clean(ST_Union(geom, p.geom)), updated_at=now() where id=nb;
    update zone_draft_cells set geom = zv2_clean(ST_Difference(geom, p.geom)), updated_at=now() where id=p.id;
    n := n+1;
  end loop;
  delete from zone_draft_cells where city_id=_city and (geom is null or ST_IsEmpty(geom) or ST_Area(geom::geography) < 2000);
  return n; end $$;

create or replace function public.zv2_assert_no_overlap(_city uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a numeric; begin
  select coalesce(max(ST_Area(ST_Intersection(x.geom,y.geom)::geography)),0) into a
  from zone_draft_cells x join zone_draft_cells y on x.city_id=y.city_id and x.id<y.id and ST_Intersects(x.geom,y.geom)
  where x.city_id=_city;
  if a > 1 then raise exception 'Rejected: this change makes zones overlap (% m²).', round(a); end if;
end $$;

-- API
create or replace function public.zv2_state(_city uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cb extensions.geometry; u extensions.geometry; gap extensions.geometry; pct numeric := 0; begin
  perform zv2_require(_city);
  select geom into cb from city_boundaries where city_id=_city;
  select ST_Union(geom) into u from zone_draft_cells where city_id=_city;
  if cb is not null then
    gap := case when u is null then cb else ST_CollectionExtract(ST_Difference(cb,u),3) end;
    if gap is not null and not ST_IsEmpty(gap) and ST_Area(gap::geography) > 1 then
      pct := round(100 * ST_Area(gap::geography)::numeric / nullif(ST_Area(cb::geography)::numeric,0), 2);
    else gap := null; end if;
  end if;
  return jsonb_build_object(
    'boundary', case when cb is null then null else ST_AsGeoJSON(cb,7)::jsonb end,
    'gap', case when gap is null then null else ST_AsGeoJSON(gap,7)::jsonb end,
    'gap_pct', pct,
    'undo_count', (select count(*) from zone_draft_history where city_id=_city),
    'cells', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'colour',colour,
       'area_m2', round(ST_Area(geom::geography)), 'geom', ST_AsGeoJSON(geom,7)::jsonb) order by name)
       from zone_draft_cells where city_id=_city),'[]'),
    'old_zones', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'geom',ST_AsGeoJSON(geom,7)::jsonb))
       from zones where city_id=_city and deleted_at is null and geom is not null),'[]'));
end $$;

create or replace function public.zv2_save_boundary(_city uuid, _geojson jsonb, _source text, _reset boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g extensions.geometry; before jsonb; begin
  perform zv2_require(_city);
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  if g is null or ST_IsEmpty(g) then raise exception 'Invalid boundary'; end if;
  select ST_AsGeoJSON(geom)::jsonb into before from city_boundaries where city_id=_city;
  perform zv2_snapshot(_city, 'boundary');
  insert into city_boundaries(city_id, geom, source, saved_by, updated_at) values (_city,g,coalesce(_source,'manual'),auth.uid(),now())
    on conflict (city_id) do update set geom=excluded.geom, source=excluded.source, saved_by=excluded.saved_by, updated_at=now();
  if _reset or not exists (select 1 from zone_draft_cells where city_id=_city) then
    delete from zone_draft_cells where city_id=_city;
    insert into zone_draft_cells(city_id,name,geom) select _city, name||' — Zone 1', g from cities where id=_city;
  else
    -- clip cells to the new boundary
    update zone_draft_cells set geom = zv2_clean(ST_Intersection(geom,g)), updated_at=now() where city_id=_city;
    perform zv2_normalize(_city);
  end if;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_city_boundary_save','city_boundaries',_city, before, ST_AsGeoJSON(g)::jsonb);
  return zv2_state(_city); end $$;

create or replace function public.zv2_split(_cell uuid, _line jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c record; ln extensions.geometry; parts extensions.geometry; big extensions.geometry; rest extensions.geometry; n int; nm text; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c.city_id);
  ln := ST_SetSRID(ST_GeomFromGeoJSON(_line::text),4326);
  parts := ST_CollectionExtract(ST_Split(ST_Snap(c.geom, ln, 0.0000001), ln),3);
  n := ST_NumGeometries(parts);
  if n < 2 then raise exception 'The line must cross the zone from one edge to the other.'; end if;
  select d.geom into big from ST_Dump(parts) d order by ST_Area(d.geom) desc limit 1;
  -- side A = largest piece plus pieces touching nothing else; keep simple: largest piece vs everything else
  rest := zv2_clean(ST_Difference(c.geom, big));
  perform zv2_snapshot(c.city_id,'split');
  update zone_draft_cells set geom = zv2_clean(big), updated_at=now() where id=_cell;
  select 'Zone '||(count(*)+1) into nm from zone_draft_cells where city_id=c.city_id;
  insert into zone_draft_cells(city_id,name,colour,geom) values (c.city_id, nm,
    (array['#3B82F6','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#EC4899','#84CC16','#F97316'])[1+floor(random()*8)::int], rest);
  perform zv2_normalize(c.city_id); perform zv2_assert_no_overlap(c.city_id);
  return zv2_state(c.city_id); end $$;

create or replace function public.zv2_move_point(_city uuid, _old_lat float8, _old_lng float8, _lat float8, _lng float8)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare o extensions.geometry := ST_SetSRID(ST_MakePoint(_old_lng,_old_lat),4326); nw extensions.geometry := ST_SetSRID(ST_MakePoint(_lng,_lat),4326); k int; begin
  perform zv2_require(_city);
  perform zv2_snapshot(_city,'move_border');
  with pts as (select c.id, (d).path[1] pi, (d).path[2] ri, (d).path[3] k, (d).geom g
      from zone_draft_cells c, ST_DumpPoints(c.geom) d where c.city_id=_city and ST_DWithin(c.geom, o, 0.000002)),
    rings as (select id, pi, ri, ST_MakeLine(array_agg(case when ST_DWithin(g,o,0.000002) then nw else g end order by k)) l from pts group by id,pi,ri),
    polys as (select id, pi, ST_MakePolygon((array_agg(l order by ri))[1], coalesce((array_agg(l order by ri))[2:], array[]::extensions.geometry[])) p from rings group by id,pi),
    g as (select id, zv2_clean(ST_Collect(p)) geom from polys group by id)
  update zone_draft_cells z set geom=g.geom, updated_at=now() from g where z.id=g.id;
  get diagnostics k = row_count;
  if k = 0 then raise exception 'No zone border at that point'; end if;
  perform zv2_normalize(_city); perform zv2_assert_no_overlap(_city);
  return zv2_state(_city); end $$;

create or replace function public.zv2_set_cell_geom(_cell uuid, _geojson jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c record; g extensions.geometry; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c.city_id);
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  perform zv2_snapshot(c.city_id,'edit_shape');
  update zone_draft_cells set geom=g, updated_at=now() where id=_cell;
  perform zv2_assert_no_overlap(c.city_id); perform zv2_normalize(c.city_id);
  return zv2_state(c.city_id); end $$;

create or replace function public.zv2_merge(_a uuid, _b uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a record; b record; begin
  select * into a from zone_draft_cells where id=_a; select * into b from zone_draft_cells where id=_b;
  if a is null or b is null or a.city_id<>b.city_id then raise exception 'Zones not found'; end if;
  perform zv2_require(a.city_id);
  if ST_Length(ST_Intersection(ST_Boundary(a.geom),ST_Boundary(b.geom))::geography) < 1 then raise exception 'These zones are not neighbours.'; end if;
  perform zv2_snapshot(a.city_id,'merge');
  update zone_draft_cells set geom=zv2_clean(ST_Union(a.geom,b.geom)), updated_at=now() where id=_a;
  delete from zone_draft_cells where id=_b;
  return zv2_state(a.city_id); end $$;

create or replace function public.zv2_update_cell(_cell uuid, _name text, _colour text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c record; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c.city_id);
  if coalesce(trim(_name),'')='' then raise exception 'Name required'; end if;
  if _colour !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Invalid colour'; end if;
  perform zv2_snapshot(c.city_id,'rename');
  update zone_draft_cells set name=trim(_name), colour=_colour, updated_at=now() where id=_cell;
  return zv2_state(c.city_id); end $$;

create or replace function public.zv2_undo(_city uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare h record; begin
  perform zv2_require(_city);
  select * into h from zone_draft_history where city_id=_city order by id desc limit 1;
  if h is null then raise exception 'Nothing to undo'; end if;
  delete from zone_draft_cells where city_id=_city;
  insert into zone_draft_cells(id,city_id,name,colour,geom)
    select (e->>'id')::uuid, _city, e->>'name', e->>'colour', ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON((e->'geom')::text),4326))
    from jsonb_array_elements(h.snapshot) e;
  delete from zone_draft_history where id=h.id;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_undo','zone_draft_cells',_city, jsonb_build_object('undone',h.op), null);
  return zv2_state(_city); end $$;

-- switch-over
create or replace function public.zv2_switchover_preview(_city uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform zv2_require(_city);
  return jsonb_build_object(
    'state', zv2_state(_city),
    'experts_without_location', (select count(*) from experts e join zones z on z.id=e.zone_id where z.city_id=_city and (e.current_lat is null or e.current_lng is null)),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'old_id', z.id, 'old_name', z.name,
      'suggested', (select c.id from zone_draft_cells c where c.city_id=_city and z.geom is not null order by ST_Area(ST_Intersection(c.geom,z.geom)) desc limit 1),
      'experts', (select count(*) from experts where zone_id=z.id),
      'expert_zones', (select count(*) from expert_zones where zone_id=z.id),
      'partners', (select count(*) from partners where zone_id=z.id),
      'staff', (select count(*) from staff_user_zones where zone_id=z.id) + (select count(*) from staff_users where zone_id=z.id),
      'courier_zones', (select count(*) from courier_zones where zone_id=z.id),
      'merchants', (select count(*) from merchants where zone_id=z.id),
      'alerts', (select count(*) from dispatch_alert_events where zone_id=z.id),
      'bookings', (select count(*) from bookings where zone_id=z.id)) order by z.name)
      from zones z where z.city_id=_city and z.deleted_at is null),'[]'));
end $$;

create or replace function public.zv2_switchover_apply(_city uuid, _mapping jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare st jsonb; seg uuid; cname text; c record; nz uuid; m record; map jsonb := '{}'; o uuid; nw uuid; cnt int; res jsonb := '{}'; begin
  perform zv2_require(_city, true);
  st := zv2_state(_city);
  if (st->>'gap_pct')::numeric > 0 then raise exception 'Cover the whole city first (% %% uncovered).', st->>'gap_pct'; end if;
  perform zv2_assert_no_overlap(_city);
  if not exists (select 1 from zone_draft_cells where city_id=_city) then raise exception 'No draft zones'; end if;
  for o in select id from zones where city_id=_city and deleted_at is null loop
    if not (_mapping ? o::text) or not exists (select 1 from zone_draft_cells where id=(_mapping->>o::text)::uuid and city_id=_city)
      then raise exception 'Every old zone needs a new zone in the mapping.'; end if;
  end loop;
  select name into cname from cities where id=_city;
  select coalesce((select segment_id from zones where city_id=_city order by created_at limit 1),(select id from segments where slug='clean')) into seg;
  create temp table zv2_map(cell uuid, zone uuid) on commit drop;
  for c in select * from zone_draft_cells where city_id=_city loop
    insert into zones(name, city, city_id, segment_id, status, geom, colour) values (c.name, cname, _city, seg, 'active', c.geom, c.colour) returning id into nz;
    insert into zv2_map values (c.id, nz);
  end loop;
  for m in select key::uuid old_id, (select zone from zv2_map where cell=value::uuid) new_id from jsonb_each_text(_mapping) loop
    map := map || jsonb_build_object(m.old_id::text, m.new_id);
  end loop;
  create temp table zv2_om(old_id uuid, new_id uuid) on commit drop;
  insert into zv2_om select key::uuid, value::uuid from jsonb_each_text(map);
  -- experts: by home (last known) location, else mapping
  update experts e set zone_id = coalesce(
      (select z.id from zones z join zv2_map mm on mm.zone=z.id where e.current_lat is not null and ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint(e.current_lng,e.current_lat),4326)) limit 1),
      (select new_id from zv2_om where old_id=e.zone_id))
    where e.zone_id in (select old_id from zv2_om);
  get diagnostics cnt = row_count; res := res || jsonb_build_object('experts',cnt);
  insert into expert_zones(expert_id, zone_id, is_primary)
    select ez.expert_id, om.new_id, false from expert_zones ez join zv2_om om on om.old_id=ez.zone_id on conflict do nothing;
  delete from expert_zones where zone_id in (select old_id from zv2_om);
  update expert_zones ez set is_primary = (ez.zone_id = e.zone_id) from experts e where e.id=ez.expert_id and ez.zone_id in (select zone from zv2_map);
  insert into expert_zones(expert_id, zone_id, is_primary)
    select e.id, e.zone_id, true from experts e where e.zone_id in (select zone from zv2_map) on conflict do nothing;
  insert into staff_user_zones(staff_user_id, zone_id) select s.staff_user_id, om.new_id from staff_user_zones s join zv2_om om on om.old_id=s.zone_id on conflict do nothing;
  delete from staff_user_zones where zone_id in (select old_id from zv2_om);
  update staff_users s set zone_id = om.new_id from zv2_om om where s.zone_id=om.old_id;
  update partners p set zone_id = om.new_id from zv2_om om where p.zone_id=om.old_id;
  get diagnostics cnt = row_count; res := res || jsonb_build_object('partners',cnt);
  update courier_zones cz set zone_id = om.new_id from zv2_om om where cz.zone_id=om.old_id
    and not exists (select 1 from courier_zones x where x.zone_id=om.new_id);
  delete from courier_zones where zone_id in (select old_id from zv2_om);
  update merchants mt set zone_id = coalesce(
      (select z.id from zones z join zv2_map mm on mm.zone=z.id where mt.latitude is not null and ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint(mt.longitude,mt.latitude),4326)) limit 1),
      (select new_id from zv2_om where old_id=mt.zone_id))
    where mt.zone_id in (select old_id from zv2_om);
  get diagnostics cnt = row_count; res := res || jsonb_build_object('merchants',cnt);
  -- past bookings/orders keep their saved zone. Disable old zones.
  update zones set status='inactive', deleted_at=now(), deleted_by=auth.uid(), delete_reason='Replaced by new split zones'
    where id in (select old_id from zv2_om);
  delete from zone_draft_cells where city_id=_city;
  delete from zone_draft_history where city_id=_city;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_switchover','zones',_city, jsonb_build_object('mapping',_mapping), jsonb_build_object('old_to_new',map,'counts',res));
  return res || jsonb_build_object('new_zones',(select count(*) from zv2_map));
end $$;

-- public lookup: lat/lng -> city + zone or outside (no personal data)
create or replace function public.zone_lookup(_lat float8, _lng float8) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare p extensions.geometry := ST_SetSRID(ST_MakePoint(_lng,_lat),4326); z record; cid uuid; begin
  if _lat is null or _lng is null or abs(_lat)>90 or abs(_lng)>180 then raise exception 'Invalid location'; end if;
  select cb.city_id into cid from city_boundaries cb where ST_Intersects(cb.geom,p) limit 1;
  select zz.id, zz.name, zz.city_id into z from zones zz
    where zz.deleted_at is null and zz.status='active' and zz.geom is not null and ST_Intersects(zz.geom,p)
      and (cid is null or zz.city_id=cid)
    order by ST_Distance(ST_Centroid(zz.geom),p) limit 1;
  if z.id is null and cid is null then return jsonb_build_object('status','outside'); end if;
  cid := coalesce(cid, z.city_id);
  return jsonb_build_object('status','inside','city_id',cid,'city',(select name from cities where id=cid),
    'zone_id',z.id,'zone',z.name);
end $$;

revoke all on function public.zone_lookup(float8,float8) from public;
grant execute on function public.zone_lookup(float8,float8) to anon, authenticated, service_role;
do $$ declare f text; begin
  foreach f in array array['zv2_state(uuid)','zv2_save_boundary(uuid,jsonb,text,boolean)','zv2_split(uuid,jsonb)',
    'zv2_move_point(uuid,float8,float8,float8,float8)','zv2_set_cell_geom(uuid,jsonb)','zv2_merge(uuid,uuid)',
    'zv2_update_cell(uuid,text,text)','zv2_undo(uuid)','zv2_switchover_preview(uuid)','zv2_switchover_apply(uuid,jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop;
  foreach f in array array['zv2_require(uuid,boolean)','zv2_snapshot(uuid,text)','zv2_normalize(uuid)','zv2_assert_no_overlap(uuid)'] loop
    execute 'revoke all on function public.'||f||' from public, anon, authenticated';
  end loop; end $$;