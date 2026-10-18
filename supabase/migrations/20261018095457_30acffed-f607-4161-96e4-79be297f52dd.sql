
alter table public.zones add column if not exists is_off boolean not null default false,
  add column if not exists off_reason text, add column if not exists off_until timestamptz, add column if not exists off_by uuid;
alter table public.zone_draft_cells add column if not exists is_off boolean not null default false,
  add column if not exists off_reason text, add column if not exists off_until timestamptz, add column if not exists off_by uuid,
  add column if not exists live_zone_id uuid references public.zones(id);

-- Off is effective until off_until passes (no job needed).
create or replace function public.zone_is_off_at(_lat float8, _lng float8) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select _lat is not null and _lng is not null and exists (select 1 from zones z where z.deleted_at is null and z.status='active'
    and z.geom is not null and z.is_off and (z.off_until is null or z.off_until > now())
    and ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint(_lng,_lat),4326)));
$$;
grant execute on function public.zone_is_off_at(float8,float8) to anon, authenticated, service_role;

create or replace function public.zone_lookup(_lat double precision, _lng double precision) returns jsonb
language plpgsql stable security definer set search_path to 'public','extensions' as $function$
declare p extensions.geometry := ST_SetSRID(ST_MakePoint(_lng,_lat),4326); z record; cid uuid; begin
  if _lat is null or _lng is null or abs(_lat)>90 or abs(_lng)>180 then raise exception 'Invalid location'; end if;
  select cb.city_id into cid from city_boundaries cb where ST_Intersects(cb.geom,p) limit 1;
  select zz.id, zz.name, zz.city_id, (zz.is_off and (zz.off_until is null or zz.off_until > now())) off, zz.off_until into z from zones zz
    where zz.deleted_at is null and zz.status='active' and zz.geom is not null and ST_Intersects(zz.geom,p)
      and (cid is null or zz.city_id=cid)
    order by ST_Distance(ST_Centroid(zz.geom),p) limit 1;
  if z.id is null and cid is null then return jsonb_build_object('status','outside'); end if;
  cid := coalesce(cid, z.city_id);
  return jsonb_build_object('status','inside','city_id',cid,'city',(select name from cities where id=cid),
    'zone_id',z.id,'zone',z.name,'is_off',coalesce(z.off,false),'off_until',case when z.off then z.off_until end);
end $function$;

create or replace function public.app_zone_status(_lat float8, _lng float8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l jsonb := zone_lookup(_lat,_lng); begin
  if l->>'status'='outside' then return l || jsonb_build_object('can_order',false,'message_en','Bring badiyos to your area','message_mr','तुमच्या भागात badiyos आणा'); end if;
  if (l->>'is_off')::boolean then return l || jsonb_build_object('status','off','can_order',false,
    'message_en','We''re not serving your area right now','message_mr','सध्या तुमच्या भागात सेवा बंद आहे'); end if;
  return l || jsonb_build_object('can_order',true);
end $$;
grant execute on function public.app_zone_status(float8,float8) to anon, authenticated, service_role;

create or replace function public.app_zone_off_notify(_lat float8, _lng float8, _services text[] default '{}', _phone text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l jsonb := zone_lookup(_lat,_lng); rid uuid; begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into waitlist_requests(user_id, latitude, longitude, city, area, services, phone, source)
  values (auth.uid(), _lat, _lng, l->>'city', l->>'zone', coalesce(_services,'{}'), nullif(trim(coalesce(_phone,'')),''), 'zone_off') returning id into rid;
  return jsonb_build_object('ok',true,'id',rid);
end $$;
revoke all on function public.app_zone_off_notify(float8,float8,text[],text) from public, anon;
grant execute on function public.app_zone_off_notify(float8,float8,text[],text) to authenticated, service_role;

-- Guards on new rows only.
create or replace function public.zone_off_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME='bookings' then
    if zone_is_off_at(NEW.booking_lat, NEW.booking_lng) then raise exception 'We''re not serving your area right now / सध्या तुमच्या भागात सेवा बंद आहे'; end if;
  elsif TG_TABLE_NAME='merchant_orders' then
    if zone_is_off_at(NEW.delivery_lat, NEW.delivery_lng)
       or exists (select 1 from merchants m where m.id=NEW.merchant_id and zone_is_off_at(m.latitude, m.longitude)) then
      raise exception 'We''re not serving your area right now / सध्या तुमच्या भागात सेवा बंद आहे'; end if;
  elsif TG_TABLE_NAME='courier_orders' then
    if NEW.merchant_order_id is null and NEW.store_order_id is null
       and (zone_is_off_at(NEW.pickup_lat, NEW.pickup_lng) or zone_is_off_at(NEW.drop_lat, NEW.drop_lng)) then
      raise exception 'We''re not serving your area right now / सध्या तुमच्या भागात सेवा बंद आहे'; end if;
  end if;
  return NEW;
end $$;
drop trigger if exists a0_zone_off_guard on public.bookings;
create trigger a0_zone_off_guard before insert on public.bookings for each row execute function public.zone_off_guard();
drop trigger if exists a0_zone_off_guard on public.merchant_orders;
create trigger a0_zone_off_guard before insert on public.merchant_orders for each row execute function public.zone_off_guard();
drop trigger if exists a0_zone_off_guard on public.courier_orders;
create trigger a0_zone_off_guard before insert on public.courier_orders for each row execute function public.zone_off_guard();

create or replace function public.app_store_live(_m uuid) returns boolean
language sql stable security definer set search_path to 'public' as $function$
  SELECT EXISTS (SELECT 1 FROM merchants WHERE id=_m AND deleted_at IS NULL AND status='approved' AND coalesce(store_enabled,true)
    AND latitude IS NOT NULL AND longitude IS NOT NULL AND NOT public.zone_is_off_at(latitude, longitude)) AND public.merchant_agreement_ok(_m) $function$;

-- Keep a switched-over cell's live zone in step.
create or replace function public.zv2_sync_live(_cell uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare c record; cname text; seg uuid; nz uuid; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then return; end if;
  if c.live_zone_id is null then
    if not exists (select 1 from zone_draft_cells where city_id=c.city_id and live_zone_id is not null) then return; end if;
    select name into cname from cities where id=c.city_id;
    select coalesce((select segment_id from zones where city_id=c.city_id order by created_at limit 1),(select id from segments where slug='clean')) into seg;
    insert into zones(name, city, city_id, segment_id, status, geom, colour, is_off, off_reason, off_until, off_by)
      values (c.name, cname, c.city_id, seg, 'active', c.geom, c.colour, c.is_off, c.off_reason, c.off_until, c.off_by) returning id into nz;
    update zone_draft_cells set live_zone_id=nz where id=_cell;
  else
    update zones set name=c.name, colour=c.colour, geom=c.geom, is_off=c.is_off, off_reason=c.off_reason, off_until=c.off_until, off_by=c.off_by
      where id=c.live_zone_id;
  end if;
end $$;
revoke all on function public.zv2_sync_live(uuid) from public, anon, authenticated;

create or replace function public.zv2_remap_zone(_old uuid, _new uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update experts set zone_id=_new where zone_id=_old;
  insert into expert_zones(expert_id, zone_id, is_primary) select expert_id, _new, is_primary from expert_zones where zone_id=_old on conflict do nothing;
  delete from expert_zones where zone_id=_old;
  insert into staff_user_zones(staff_user_id, zone_id) select staff_user_id, _new from staff_user_zones where zone_id=_old on conflict do nothing;
  delete from staff_user_zones where zone_id=_old;
  update staff_users set zone_id=_new where zone_id=_old;
  update partners set zone_id=_new where zone_id=_old;
  update courier_zones set zone_id=_new where zone_id=_old and not exists (select 1 from courier_zones x where x.zone_id=_new);
  delete from courier_zones where zone_id=_old;
  update merchants set zone_id=_new where zone_id=_old;
end $$;
revoke all on function public.zv2_remap_zone(uuid,uuid) from public, anon, authenticated;

create or replace function public.zv2_cell_refs(_cell uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare z uuid; c uuid; begin
  select live_zone_id, city_id into z, c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c);
  if z is null then return jsonb_build_object('experts',0,'partners',0,'staff',0,'stores',0,'total',0); end if;
  return (select jsonb_build_object('experts',e,'partners',p,'staff',s,'stores',m,'total',e+p+s+m) from (select
    (select count(distinct expert_id) from (select id expert_id from experts where zone_id=z union select expert_id from expert_zones where zone_id=z) x)::int e,
    (select count(*) from partners where zone_id=z)::int p,
    (select count(*) from (select id from staff_users where zone_id=z union select staff_user_id from staff_user_zones where zone_id=z) y)::int s,
    (select count(*) from merchants where zone_id=z and deleted_at is null)::int m) t);
end $$;
grant execute on function public.zv2_cell_refs(uuid) to authenticated;

-- State: city area, coverage, gaps, on/off.
create or replace function public.zv2_state(_city uuid) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare u extensions.geometry; b extensions.geometry; filled extensions.geometry; gap extensions.geometry; barea numeric; garea numeric := 0; pct numeric := 0; ov numeric := 0; switched boolean; begin
  perform zv2_require(_city);
  select geom into b from city_boundaries where city_id=_city;
  select ST_Union(geom) into u from zone_draft_cells where city_id=_city;
  if b is not null then
    gap := ST_CollectionExtract(case when u is null then b else ST_Difference(b,u) end,3);
    barea := ST_Area(b::geography);
  elsif u is not null then
    select ST_Union(ST_MakePolygon(ST_ExteriorRing(d.geom))) into filled from ST_Dump(u) d;
    gap := ST_CollectionExtract(ST_Difference(filled,u),3);
    barea := ST_Area(filled::geography);
  end if;
  if gap is not null and not ST_IsEmpty(gap) and ST_Area(gap::geography) > 1 then
    garea := ST_Area(gap::geography); pct := round(100 * garea / nullif(barea,0), 2);
  else gap := null; end if;
  select coalesce(max(ST_Area(ST_Intersection(x.geom,y.geom)::geography)),0) into ov
    from zone_draft_cells x join zone_draft_cells y on x.city_id=y.city_id and x.id<y.id and ST_Intersects(x.geom,y.geom) where x.city_id=_city;
  switched := exists (select 1 from zone_draft_cells where city_id=_city and live_zone_id is not null);
  return jsonb_build_object(
    'boundary', case when b is null then null else ST_AsGeoJSON(b,7)::jsonb end,
    'city_area_km2', case when b is null then null else round(barea/1e6, 2) end,
    'gap', case when gap is null then null else ST_AsGeoJSON(gap,7)::jsonb end,
    'gap_pct', pct, 'gap_km2', round(garea/1e6, 3),
    'covered_pct', case when b is null then null else greatest(0, round(100 - pct, 2)) end,
    'overlap', ov > 1, 'switched', switched,
    'cells', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'colour',colour,
       'area_m2', round(ST_Area(geom::geography)), 'geom', ST_AsGeoJSON(geom,7)::jsonb,
       'is_off', is_off and (off_until is null or off_until > now()), 'off_reason', off_reason, 'off_until', off_until, 'live', live_zone_id is not null) order by name)
       from zone_draft_cells where city_id=_city),'[]'),
    'old_zones', coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'geom',ST_AsGeoJSON(z.geom,7)::jsonb))
       from zones z where z.city_id=_city and z.deleted_at is null and z.geom is not null
         and not exists (select 1 from zone_draft_cells c where c.live_zone_id=z.id)),'[]'));
end $function$;

create or replace function public.zv2_save_boundary(_city uuid, _geojson jsonb, _source text, _reset boolean) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare g extensions.geometry; before jsonb; a numeric; begin
  perform zv2_require(_city);
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  if g is null or ST_IsEmpty(g) then raise exception 'Invalid city area — place at least 3 points'; end if;
  a := ST_Area(g::geography);
  if a < 2000 then raise exception 'City area is too small'; end if;
  if a > 2000e6 then raise exception 'City area is too large (% km²). Draw only the city.', round(a/1e6); end if;
  select ST_AsGeoJSON(geom)::jsonb into before from city_boundaries where city_id=_city;
  insert into city_boundaries(city_id, geom, source, saved_by, updated_at) values (_city,g,coalesce(_source,'manual'),auth.uid(),now())
    on conflict (city_id) do update set geom=excluded.geom, source=excluded.source, saved_by=excluded.saved_by, updated_at=now();
  update zone_draft_cells set geom = zv2_clean(ST_Intersection(geom,g)), updated_at=now() where city_id=_city and not ST_CoveredBy(geom,g);
  delete from zone_draft_cells where city_id=_city and live_zone_id is null and (geom is null or ST_IsEmpty(geom) or ST_Area(geom::geography) < 2000);
  perform zv2_sync_live(id) from zone_draft_cells where city_id=_city and live_zone_id is not null;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_city_area_save','city_boundaries',_city, before, ST_AsGeoJSON(g)::jsonb);
  return zv2_state(_city); end $function$;

create or replace function public.zv2_save_zone(_city uuid, _cell uuid, _name text, _colour text, _geojson jsonb) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare g extensions.geometry; b extensions.geometry; others extensions.geometry; cid uuid := _cell; before jsonb; begin
  perform zv2_require(_city);
  if coalesce(trim(_name),'')='' or length(trim(_name))>60 then raise exception 'Zone name required (max 60 characters)'; end if;
  if _colour !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Invalid colour'; end if;
  if _cell is not null and not exists (select 1 from zone_draft_cells where id=_cell and city_id=_city) then raise exception 'Zone not found'; end if;
  select geom into b from city_boundaries where city_id=_city;
  if b is null then raise exception 'Draw the city area first'; end if;
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  if g is null or ST_IsEmpty(g) then raise exception 'Invalid shape — place at least 3 points'; end if;
  if ST_Area(g::geography) > 200e6 then raise exception 'Zone is too large (% km²). Draw a smaller area.', round(ST_Area(g::geography)/1e6); end if;
  g := zv2_clean(ST_Snap(g, ST_Boundary(b), 0.00045));
  g := zv2_clean(ST_Intersection(g, b));
  select ST_Union(geom) into others from zone_draft_cells where city_id=_city and (_cell is null or id<>_cell);
  if others is not null and g is not null then
    g := zv2_clean(ST_Snap(g, others, 0.00045));
    g := zv2_clean(ST_Difference(g, others));
  end if;
  if g is null or ST_IsEmpty(g) or ST_Area(g::geography) < 2000 then raise exception 'This shape is outside the city area or fully inside other zones.'; end if;
  if _cell is not null then select to_jsonb(c) - 'geom' into before from zone_draft_cells c where id=_cell; end if;
  if _cell is null then
    insert into zone_draft_cells(city_id,name,colour,geom) values (_city, trim(_name), _colour, g) returning id into cid;
  else
    update zone_draft_cells set name=trim(_name), colour=_colour, geom=g, updated_at=now() where id=_cell;
  end if;
  perform zv2_assert_no_overlap(_city);
  perform zv2_sync_live(cid);
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _cell is null then 'zones_v2_new_zone' else 'zones_v2_edit_zone' end, 'zone_draft_cells', cid, before,
    jsonb_build_object('name',trim(_name),'colour',_colour,'area_m2',round(ST_Area(g::geography))));
  return zv2_state(_city) || jsonb_build_object('saved_id', cid);
end $function$;

drop function if exists public.zv2_delete_cell(uuid);
create or replace function public.zv2_delete_cell(_cell uuid, _move_to uuid default null) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare c record; t record; refs jsonb; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c.city_id);
  if c.live_zone_id is not null then
    refs := zv2_cell_refs(_cell);
    if (refs->>'total')::int > 0 then
      if _move_to is null then raise exception 'This zone is in use — choose a zone to move them to.'; end if;
      select * into t from zone_draft_cells where id=_move_to and city_id=c.city_id and id<>_cell;
      if t is null or t.live_zone_id is null then raise exception 'Choose a live zone to move to'; end if;
      perform zv2_remap_zone(c.live_zone_id, t.live_zone_id);
    end if;
    update zones set status='inactive', deleted_at=now(), deleted_by=auth.uid(), delete_reason='Deleted in zone editor' where id=c.live_zone_id;
  end if;
  delete from zone_draft_cells where id=_cell;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_delete_zone','zone_draft_cells',_cell, to_jsonb(c) - 'geom', jsonb_build_object('moved_to',_move_to,'refs',refs));
  return zv2_state(c.city_id);
end $function$;
grant execute on function public.zv2_delete_cell(uuid,uuid) to authenticated;

create or replace function public.staff_set_zone_off(_cell uuid, _off boolean, _reason text default null, _until timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c.city_id);
  if _off and _until is not null and _until <= now() then raise exception '"Turn back on at" must be in the future'; end if;
  update zone_draft_cells set is_off=_off, off_reason=case when _off then nullif(trim(coalesce(_reason,'')),'') end,
    off_until=case when _off then _until end, off_by=case when _off then auth.uid() end, updated_at=now() where id=_cell;
  perform zv2_sync_live(_cell);
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _off then 'zone_turned_off' else 'zone_turned_on' end, 'zone_draft_cells', _cell,
    jsonb_build_object('is_off',c.is_off,'off_reason',c.off_reason,'off_until',c.off_until),
    jsonb_build_object('is_off',_off,'off_reason',_reason,'off_until',_until,'zone',c.name));
  return zv2_state(c.city_id);
end $$;
grant execute on function public.staff_set_zone_off(uuid,boolean,text,timestamptz) to authenticated;

-- Fill gaps.
create or replace function public.zv2_gap_pieces(_city uuid) returns table(idx int, geom extensions.geometry, area_m2 numeric, target uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare b extensions.geometry; u extensions.geometry; begin
  select cb.geom into b from city_boundaries cb where cb.city_id=_city; if b is null then return; end if;
  select ST_Union(c.geom) into u from zone_draft_cells c where c.city_id=_city;
  return query
  with p as (select d.geom g from ST_Dump(ST_CollectionExtract(case when u is null then b else ST_Difference(b,u) end,3)) d where ST_Area(d.geom::geography) > 1),
  n as (select row_number() over (order by ST_Area(p.g::geography) desc, ST_XMin(p.g))::int i, p.g from p)
  select n.i, n.g, round(ST_Area(n.g::geography)::numeric),
    (select c.id from zone_draft_cells c where c.city_id=_city and ST_DWithin(c.geom, n.g, 0.00001)
       order by ST_Length(ST_Intersection(ST_Boundary(c.geom), ST_Buffer(n.g, 0.00001))::geography) desc limit 1)
  from n;
end $$;
revoke all on function public.zv2_gap_pieces(uuid) from public, anon, authenticated;

create or replace function public.zv2_fill_gaps_preview(_city uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform zv2_require(_city);
  return coalesce((select jsonb_agg(jsonb_build_object('idx',g.idx,'area_m2',g.area_m2,'target',g.target,
    'target_name',(select name from zone_draft_cells where id=g.target),'geom',ST_AsGeoJSON(g.geom,7)::jsonb) order by g.idx)
    from zv2_gap_pieces(_city) g),'[]');
end $$;
grant execute on function public.zv2_fill_gaps_preview(uuid) to authenticated;

create or replace function public.zv2_fill_gaps_apply(_city uuid, _as_new int[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; n int := 0; k int := 0; nid uuid; begin
  perform zv2_require(_city);
  create temp table zv2_gp on commit drop as select * from zv2_gap_pieces(_city);
  for r in select * from zv2_gp order by idx loop
    if r.target is null or r.idx = any(coalesce(_as_new,'{}')) then
      if r.area_m2 < 2000 and r.target is not null then
        update zone_draft_cells set geom=zv2_clean(ST_Union(geom, r.geom)), updated_at=now() where id=r.target;
      else
        k := k+1;
        insert into zone_draft_cells(city_id,name,colour,geom) values (_city, 'New zone '||(select count(*)+1 from zone_draft_cells where city_id=_city), '#94A3B8', zv2_clean(r.geom)) returning id into nid;
        perform zv2_sync_live(nid);
      end if;
    else
      update zone_draft_cells set geom=zv2_clean(ST_Union(geom, r.geom)), updated_at=now() where id=r.target;
      perform zv2_sync_live(r.target);
    end if;
    n := n+1;
  end loop;
  perform zv2_assert_no_overlap(_city);
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_fill_gaps','zone_draft_cells',_city,null,jsonb_build_object('pieces',n,'new_zones',k));
  return zv2_state(_city) || jsonb_build_object('filled',n,'new_zones',k);
end $$;
grant execute on function public.zv2_fill_gaps_apply(uuid,int[]) to authenticated;

create or replace function public.zv2_cities() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'state',c.state,'status',c.status,
    'area_km2',(select round((ST_Area(b.geom::geography)/1e6)::numeric,2) from city_boundaries b where b.city_id=c.id),
    'zones',(select count(*) from zone_draft_cells z where z.city_id=c.id),
    'live_zones',(select count(*) from zones z where z.city_id=c.id and z.deleted_at is null)) order by c.is_default desc, c.name),'[]')
  from cities c where c.id = any(staff_allowed_city_ids())
    and exists (select 1 from staff_users s where s.auth_user_id=auth.uid() and s.status='active' and s.role in ('super_admin','ops_manager'));
$$;
grant execute on function public.zv2_cities() to authenticated;

-- Switch-over: keep the drawn zones as the editable live zones.
create or replace function public.zv2_switchover_apply(_city uuid, _mapping jsonb) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare st jsonb; seg uuid; cname text; c record; nz uuid; m record; map jsonb := '{}'; o uuid; cnt int; res jsonb := '{}'; begin
  perform zv2_require(_city, true);
  if not exists (select 1 from city_boundaries where city_id=_city) then raise exception 'Draw the city area first'; end if;
  st := zv2_state(_city);
  if (st->>'gap_pct')::numeric > 0 then raise exception 'Cover the whole city first (% %% uncovered).', st->>'gap_pct'; end if;
  perform zv2_assert_no_overlap(_city);
  if not exists (select 1 from zone_draft_cells where city_id=_city) then raise exception 'No zones drawn'; end if;
  if exists (select 1 from zone_draft_cells where city_id=_city and live_zone_id is not null) then raise exception 'These zones are already live'; end if;
  for o in select id from zones where city_id=_city and deleted_at is null loop
    if not (_mapping ? o::text) or not exists (select 1 from zone_draft_cells where id=(_mapping->>o::text)::uuid and city_id=_city)
      then raise exception 'Every old zone needs a new zone in the mapping.'; end if;
  end loop;
  select name into cname from cities where id=_city;
  select coalesce((select segment_id from zones where city_id=_city order by created_at limit 1),(select id from segments where slug='clean')) into seg;
  create temp table zv2_map(cell uuid, zone uuid) on commit drop;
  for c in select * from zone_draft_cells where city_id=_city loop
    insert into zones(name, city, city_id, segment_id, status, geom, colour, is_off, off_reason, off_until, off_by)
      values (c.name, cname, _city, seg, 'active', c.geom, c.colour, c.is_off, c.off_reason, c.off_until, c.off_by) returning id into nz;
    insert into zv2_map values (c.id, nz);
  end loop;
  for m in select key::uuid old_id, (select zone from zv2_map where cell=value::uuid) new_id from jsonb_each_text(_mapping) loop
    map := map || jsonb_build_object(m.old_id::text, m.new_id);
  end loop;
  create temp table zv2_om(old_id uuid, new_id uuid) on commit drop;
  insert into zv2_om select key::uuid, value::uuid from jsonb_each_text(map);
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
  update zones set status='inactive', deleted_at=now(), deleted_by=auth.uid(), delete_reason='Replaced by new zones'
    where id in (select old_id from zv2_om);
  update zone_draft_cells dc set live_zone_id = mm.zone from zv2_map mm where mm.cell=dc.id;
  delete from zone_draft_history where city_id=_city;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),'zones_v2_switchover','zones',_city, jsonb_build_object('mapping',_mapping), jsonb_build_object('old_to_new',map,'counts',res));
  return res || jsonb_build_object('new_zones',(select count(*) from zv2_map));
end $function$;

-- Split tools are no longer used by the screen.
