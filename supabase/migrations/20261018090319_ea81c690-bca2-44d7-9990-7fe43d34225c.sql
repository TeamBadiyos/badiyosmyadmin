-- Simple zone editor: discard district-sized draft + auto city border
delete from public.zone_draft_cells where city_id='a689c0f7-8356-4848-ae4a-af73ab52d041';
delete from public.zone_draft_history where city_id='a689c0f7-8356-4848-ae4a-af73ab52d041';
delete from public.city_boundaries where city_id='a689c0f7-8356-4848-ae4a-af73ab52d041';

-- State: service area = union of zones; gaps = holes inside the outer shape
create or replace function public.zv2_state(_city uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u extensions.geometry; filled extensions.geometry; gap extensions.geometry; pct numeric := 0; ov numeric := 0; begin
  perform zv2_require(_city);
  select ST_Union(geom) into u from zone_draft_cells where city_id=_city;
  if u is not null then
    select ST_Union(ST_MakePolygon(ST_ExteriorRing(d.geom))) into filled from ST_Dump(u) d;
    gap := ST_CollectionExtract(ST_Difference(filled,u),3);
    if gap is not null and not ST_IsEmpty(gap) and ST_Area(gap::geography) > 1 then
      pct := round(100 * ST_Area(gap::geography)::numeric / nullif(ST_Area(filled::geography)::numeric,0), 2);
    else gap := null; end if;
  end if;
  select coalesce(max(ST_Area(ST_Intersection(x.geom,y.geom)::geography)),0) into ov
    from zone_draft_cells x join zone_draft_cells y on x.city_id=y.city_id and x.id<y.id and ST_Intersects(x.geom,y.geom) where x.city_id=_city;
  return jsonb_build_object(
    'boundary', null,
    'gap', case when gap is null then null else ST_AsGeoJSON(gap,7)::jsonb end,
    'gap_pct', pct, 'overlap', ov > 1,
    'undo_count', (select count(*) from zone_draft_history where city_id=_city),
    'cells', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'colour',colour,
       'area_m2', round(ST_Area(geom::geography)), 'geom', ST_AsGeoJSON(geom,7)::jsonb) order by name)
       from zone_draft_cells where city_id=_city),'[]'),
    'old_zones', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'geom',ST_AsGeoJSON(geom,7)::jsonb))
       from zones where city_id=_city and deleted_at is null and geom is not null),'[]'));
end $$;

-- Create or update a zone: snap to neighbours within 50 m, trim overlaps
create or replace function public.zv2_save_zone(_city uuid, _cell uuid, _name text, _colour text, _geojson jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g extensions.geometry; others extensions.geometry; cid uuid := _cell; begin
  perform zv2_require(_city);
  if coalesce(trim(_name),'')='' or length(trim(_name))>60 then raise exception 'Zone name required (max 60 characters)'; end if;
  if _colour !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Invalid colour'; end if;
  if _cell is not null and not exists (select 1 from zone_draft_cells where id=_cell and city_id=_city) then raise exception 'Zone not found'; end if;
  g := zv2_clean(ST_SetSRID(ST_GeomFromGeoJSON(_geojson::text),4326));
  if g is null or ST_IsEmpty(g) then raise exception 'Invalid shape — place at least 3 points'; end if;
  if ST_Area(g::geography) > 200e6 then raise exception 'Zone is too large (% km²). Draw a smaller area.', round(ST_Area(g::geography)/1e6); end if;
  select ST_Union(geom) into others from zone_draft_cells where city_id=_city and (_cell is null or id<>_cell);
  if others is not null then
    g := zv2_clean(ST_Snap(g, others, 0.00045));
    g := zv2_clean(ST_Difference(g, others));
  end if;
  if g is null or ST_IsEmpty(g) or ST_Area(g::geography) < 2000 then raise exception 'This shape is fully inside other zones.'; end if;
  perform zv2_snapshot(_city, case when _cell is null then 'new_zone' else 'edit_zone' end);
  if _cell is null then
    insert into zone_draft_cells(city_id,name,colour,geom) values (_city, trim(_name), _colour, g) returning id into cid;
  else
    update zone_draft_cells set name=trim(_name), colour=_colour, geom=g, updated_at=now() where id=_cell;
  end if;
  perform zv2_assert_no_overlap(_city);
  return zv2_state(_city) || jsonb_build_object('saved_id', cid);
end $$;

create or replace function public.zv2_delete_cell(_cell uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c record; begin
  select * into c from zone_draft_cells where id=_cell; if c is null then raise exception 'Zone not found'; end if;
  perform zv2_require(c.city_id);
  perform zv2_snapshot(c.city_id,'delete_zone');
  delete from zone_draft_cells where id=_cell;
  return zv2_state(c.city_id);
end $$;

revoke all on function public.zv2_save_zone(uuid,uuid,text,text,jsonb) from public, anon;
revoke all on function public.zv2_delete_cell(uuid) from public, anon;
grant execute on function public.zv2_save_zone(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.zv2_delete_cell(uuid) to authenticated;