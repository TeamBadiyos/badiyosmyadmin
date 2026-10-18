create or replace function public.zv2_save_zone(_city uuid, _cell uuid, _name text, _colour text, _geojson jsonb) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare g extensions.geometry; b extensions.geometry; others extensions.geometry; cid uuid := _cell; before jsonb; n record; ng extensions.geometry; gp record; begin
  perform zv2_require(_city);
  if coalesce(trim(_name),'')='' or length(trim(_name))>60 then raise exception 'Zone name required (max 60 characters)'; end if;
  if _colour !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Invalid colour'; end if;
  if _cell is not null and not exists (select 1 from zone_draft_cells where id=_cell and city_id=_city) then raise exception 'Zone not found'; end if;
  select geom into b from city_boundaries where city_id=_city;
  if b is null then raise exception 'Draw the city area first'; end if;
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  if g is null or ST_IsEmpty(g) then raise exception 'Invalid shape — place at least 3 points'; end if;
  if ST_Area(g::geography) > 200e6 then raise exception 'Zone is too large (% km²). Draw a smaller area.', round(ST_Area(g::geography)/1e6); end if;
  -- snap to city edge (~100 m) and to neighbours (~50 m), then clip to city
  g := zv2_clean(ST_Snap(g, ST_Boundary(b), 0.0009));
  select ST_Union(geom) into others from zone_draft_cells where city_id=_city and (_cell is null or id<>_cell);
  if others is not null then g := zv2_clean(ST_Snap(g, others, 0.00045)); end if;
  g := zv2_clean(ST_Intersection(g, b));
  if _cell is null and others is not null and g is not null then
    -- new zone: never steal from existing zones
    g := zv2_clean(ST_Difference(g, others));
  end if;
  if g is null or ST_IsEmpty(g) or ST_Area(g::geography) < 2000 then raise exception 'This shape is outside the city area or fully inside other zones.'; end if;
  if _cell is not null then
    -- edited zone keeps its new shape; overlapped neighbours give way
    for n in select id, name, geom from zone_draft_cells where city_id=_city and id<>_cell and ST_Intersects(geom, g) loop
      ng := zv2_clean(ST_Difference(n.geom, g));
      if ng is null or ST_IsEmpty(ng) or ST_Area(ng::geography) < 2000 then
        raise exception 'This edit would cover all of zone "%". Delete that zone first or draw smaller.', n.name;
      end if;
      update zone_draft_cells set geom=ng, updated_at=now() where id=n.id;
    end loop;
    select to_jsonb(c) - 'geom' into before from zone_draft_cells c where id=_cell;
    update zone_draft_cells set name=trim(_name), colour=_colour, geom=g, updated_at=now() where id=_cell;
  else
    insert into zone_draft_cells(city_id,name,colour,geom) values (_city, trim(_name), _colour, g) returning id into cid;
  end if;
  -- auto-absorb small slivers (< 0.1 km²) into the neighbour sharing the longest edge
  create temp table if not exists zv2_gp_auto (idx int, geom extensions.geometry, area_m2 numeric, target uuid) on commit drop;
  delete from zv2_gp_auto;
  insert into zv2_gp_auto select * from zv2_gap_pieces(_city);
  for gp in select * from zv2_gp_auto where area_m2 < 100000 loop
    if gp.target is null then
      select c.id into gp.target from zone_draft_cells c where c.city_id=_city order by ST_Distance(c.geom, gp.geom) limit 1;
    end if;
    if gp.target is not null then
      update zone_draft_cells set geom=zv2_clean(ST_Union(geom, gp.geom)), updated_at=now() where id=gp.target;
    end if;
  end loop;
  perform zv2_assert_no_overlap(_city);
  for n in select id from zone_draft_cells where city_id=_city loop perform zv2_sync_live(n.id); end loop;
  insert into audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _cell is null then 'zones_v2_new_zone' else 'zones_v2_edit_zone' end, 'zone_draft_cells', cid, before,
    jsonb_build_object('name',trim(_name),'colour',_colour,'area_m2',round(ST_Area(g::geography))));
  return zv2_state(_city) || jsonb_build_object('saved_id', cid);
end $function$;
revoke execute on function public.zv2_save_zone(uuid,uuid,text,text,jsonb) from public, anon;
grant execute on function public.zv2_save_zone(uuid,uuid,text,text,jsonb) to authenticated;