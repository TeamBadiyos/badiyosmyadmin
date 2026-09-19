
create or replace function public.staff_courier_upsert_vehicle_type(
  _id uuid,
  _name text,
  _icon text,
  _max_weight_kg numeric,
  _inclusions text[],
  _exclusions text[],
  _required_skill uuid,
  _required_documents text[],
  _sort_order integer,
  _is_active boolean
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb; _rid uuid;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(btrim(_name),'') = '' then raise exception 'Name required'; end if;

  if _id is null then
    insert into public.courier_vehicle_types
      (name, icon, max_weight_kg, inclusions, exclusions, required_skill, required_documents, sort_order, is_active)
    values (btrim(_name), nullif(btrim(coalesce(_icon,'')),''), coalesce(_max_weight_kg,20),
            coalesce(_inclusions,'{}'), coalesce(_exclusions,'{}'), _required_skill,
            coalesce(_required_documents,'{}'), coalesce(_sort_order,0), coalesce(_is_active,false))
    returning id into _rid;
  else
    select to_jsonb(v), v.id into _before, _rid from public.courier_vehicle_types v where v.id=_id;
    if _rid is null then raise exception 'Vehicle type not found'; end if;
    update public.courier_vehicle_types set
      name=btrim(_name),
      icon=nullif(btrim(coalesce(_icon,'')),''),
      max_weight_kg=coalesce(_max_weight_kg,20),
      inclusions=coalesce(_inclusions,'{}'),
      exclusions=coalesce(_exclusions,'{}'),
      required_skill=_required_skill,
      required_documents=coalesce(_required_documents,'{}'),
      sort_order=coalesce(_sort_order,0),
      is_active=coalesce(_is_active,false),
      updated_at=now()
    where id=_rid;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _before is null then 'courier_vehicle_type_create' else 'courier_vehicle_type_update' end,
          'courier_vehicle_types', _rid, _before,
          (select to_jsonb(v) from public.courier_vehicle_types v where v.id=_rid));
  return _rid;
end $$;

create or replace function public.staff_courier_set_vehicle_type_active(_id uuid, _is_active boolean)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(v) into _before from public.courier_vehicle_types v where v.id=_id;
  if _before is null then raise exception 'Vehicle type not found'; end if;
  update public.courier_vehicle_types set is_active=coalesce(_is_active,false), updated_at=now() where id=_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_vehicle_type_set_active', 'courier_vehicle_types', _id, _before,
          (select to_jsonb(v) from public.courier_vehicle_types v where v.id=_id));
end $$;

create or replace function public.staff_courier_upsert_rate(
  _id uuid,
  _city text,
  _vehicle_type_id uuid,
  _base_fare numeric,
  _included_km numeric,
  _per_km numeric,
  _min_fare numeric,
  _platform_fee numeric,
  _commission_pct numeric
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb; _rid uuid;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(btrim(_city),'') = '' then raise exception 'City required'; end if;
  if _vehicle_type_id is null then raise exception 'Vehicle type required'; end if;

  if _id is not null then
    select to_jsonb(r), r.id into _before, _rid from public.courier_vehicle_rates r where r.id=_id;
    if _rid is null then raise exception 'Rate not found'; end if;
  else
    select to_jsonb(r), r.id into _before, _rid from public.courier_vehicle_rates r
     where lower(r.city)=lower(btrim(_city)) and r.vehicle_type_id=_vehicle_type_id;
  end if;

  if _rid is null then
    insert into public.courier_vehicle_rates
      (city, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct)
    values (btrim(_city), _vehicle_type_id, coalesce(_base_fare,0), coalesce(_included_km,0),
            coalesce(_per_km,0), coalesce(_min_fare,0), coalesce(_platform_fee,0), coalesce(_commission_pct,0))
    returning id into _rid;
  else
    update public.courier_vehicle_rates set
      city=btrim(_city), vehicle_type_id=_vehicle_type_id,
      base_fare=coalesce(_base_fare,0), included_km=coalesce(_included_km,0),
      per_km=coalesce(_per_km,0), min_fare=coalesce(_min_fare,0),
      platform_fee=coalesce(_platform_fee,0), commission_pct=coalesce(_commission_pct,0),
      updated_at=now()
    where id=_rid;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _before is null then 'courier_rate_create' else 'courier_rate_update' end,
          'courier_vehicle_rates', _rid, _before,
          (select to_jsonb(r) from public.courier_vehicle_rates r where r.id=_rid));
  return _rid;
end $$;

create or replace function public.staff_courier_confirm_rate(_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(r) into _before from public.courier_vehicle_rates r where r.id=_id;
  if _before is null then raise exception 'Rate not found'; end if;
  update public.courier_vehicle_rates set is_placeholder=false, updated_at=now() where id=_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_rate_confirm', 'courier_vehicle_rates', _id, _before,
          (select to_jsonb(r) from public.courier_vehicle_rates r where r.id=_id));
end $$;

create or replace function public.staff_courier_upsert_courier_type(
  _id uuid,
  _name text,
  _icon text,
  _extra_fee numeric,
  _instructions text,
  _sort_order integer,
  _is_active boolean
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb; _rid uuid;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(btrim(_name),'') = '' then raise exception 'Name required'; end if;

  if _id is null then
    insert into public.courier_types (name, icon, extra_fee, instructions, sort_order, is_active)
    values (btrim(_name), nullif(btrim(coalesce(_icon,'')),''), coalesce(_extra_fee,0),
            nullif(btrim(coalesce(_instructions,'')),''), coalesce(_sort_order,0), coalesce(_is_active,true))
    returning id into _rid;
  else
    select to_jsonb(t), t.id into _before, _rid from public.courier_types t where t.id=_id;
    if _rid is null then raise exception 'Courier type not found'; end if;
    update public.courier_types set
      name=btrim(_name), icon=nullif(btrim(coalesce(_icon,'')),''),
      extra_fee=coalesce(_extra_fee,0),
      instructions=nullif(btrim(coalesce(_instructions,'')),''),
      sort_order=coalesce(_sort_order,0), is_active=coalesce(_is_active,true), updated_at=now()
    where id=_rid;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _before is null then 'courier_type_create' else 'courier_type_update' end,
          'courier_types', _rid, _before,
          (select to_jsonb(t) from public.courier_types t where t.id=_rid));
  return _rid;
end $$;

create or replace function public.staff_courier_set_courier_type_active(_id uuid, _is_active boolean)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(t) into _before from public.courier_types t where t.id=_id;
  if _before is null then raise exception 'Courier type not found'; end if;
  update public.courier_types set is_active=coalesce(_is_active,true), updated_at=now() where id=_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_type_set_active', 'courier_types', _id, _before,
          (select to_jsonb(t) from public.courier_types t where t.id=_id));
end $$;

create or replace function public.staff_courier_set_vehicle_courier_type(
  _vehicle_type_id uuid, _courier_type_id uuid, _is_active boolean
) returns void language plpgsql security definer set search_path to 'public'
as $$
declare _before jsonb; _rid uuid;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(m), m.id into _before, _rid from public.courier_vehicle_courier_types m
   where m.vehicle_type_id=_vehicle_type_id and m.courier_type_id=_courier_type_id;
  if _rid is null then
    insert into public.courier_vehicle_courier_types (vehicle_type_id, courier_type_id, is_active)
    values (_vehicle_type_id, _courier_type_id, coalesce(_is_active,true))
    returning id into _rid;
  else
    update public.courier_vehicle_courier_types set is_active=coalesce(_is_active,true) where id=_rid;
  end if;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_vehicle_type_mapping', 'courier_vehicle_courier_types', _rid, _before,
          (select to_jsonb(m) from public.courier_vehicle_courier_types m where m.id=_rid));
end $$;

revoke all on function public.staff_courier_upsert_vehicle_type(uuid,text,text,numeric,text[],text[],uuid,text[],integer,boolean) from public, anon;
revoke all on function public.staff_courier_set_vehicle_type_active(uuid,boolean) from public, anon;
revoke all on function public.staff_courier_upsert_rate(uuid,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric) from public, anon;
revoke all on function public.staff_courier_confirm_rate(uuid) from public, anon;
revoke all on function public.staff_courier_upsert_courier_type(uuid,text,text,numeric,text,integer,boolean) from public, anon;
revoke all on function public.staff_courier_set_courier_type_active(uuid,boolean) from public, anon;
revoke all on function public.staff_courier_set_vehicle_courier_type(uuid,uuid,boolean) from public, anon;

grant execute on function public.staff_courier_upsert_vehicle_type(uuid,text,text,numeric,text[],text[],uuid,text[],integer,boolean) to authenticated;
grant execute on function public.staff_courier_set_vehicle_type_active(uuid,boolean) to authenticated;
grant execute on function public.staff_courier_upsert_rate(uuid,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.staff_courier_confirm_rate(uuid) to authenticated;
grant execute on function public.staff_courier_upsert_courier_type(uuid,text,text,numeric,text,integer,boolean) to authenticated;
grant execute on function public.staff_courier_set_courier_type_active(uuid,boolean) to authenticated;
grant execute on function public.staff_courier_set_vehicle_courier_type(uuid,uuid,boolean) to authenticated;
