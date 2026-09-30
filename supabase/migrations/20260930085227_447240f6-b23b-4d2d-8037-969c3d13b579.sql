create or replace function public.staff_upsert_customer_address(
  _user_id uuid,
  _address_id uuid,
  _label text,
  _full_address text,
  _area text,
  _city text,
  _pincode text,
  _latitude numeric,
  _longitude numeric,
  _is_default boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare _id uuid; _before jsonb;
begin
  if not public.courier_is_ops_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if _user_id is null then raise exception 'Customer is required'; end if;
  if coalesce(btrim(_full_address), '') = '' then raise exception 'Full address is required'; end if;

  if _address_id is null then
    insert into public.addresses (user_id, label, full_address, area, city, pincode, latitude, longitude, is_default)
    values (_user_id, nullif(btrim(_label),''), btrim(_full_address), nullif(btrim(_area),''),
            nullif(btrim(_city),''), nullif(btrim(_pincode),''), _latitude, _longitude, coalesce(_is_default,false))
    returning id into _id;
  else
    select to_jsonb(a) into _before from public.addresses a where a.id = _address_id and a.user_id = _user_id;
    if _before is null then raise exception 'Address not found'; end if;
    update public.addresses
       set label = nullif(btrim(_label),''),
           full_address = btrim(_full_address),
           area = nullif(btrim(_area),''),
           city = nullif(btrim(_city),''),
           pincode = nullif(btrim(_pincode),''),
           latitude = _latitude,
           longitude = _longitude,
           is_default = coalesce(_is_default, is_default)
     where id = _address_id and user_id = _user_id
    returning id into _id;
  end if;

  if coalesce(_is_default,false) then
    update public.addresses set is_default = false where user_id = _user_id and id <> _id;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(),
          case when _address_id is null then 'customer_address_create' else 'customer_address_update' end,
          'addresses', _id, _before,
          (select to_jsonb(a) from public.addresses a where a.id = _id));
  return _id;
end $$;

create or replace function public.staff_delete_customer_address(_address_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare _before jsonb; _uid uuid;
begin
  if not public.courier_is_ops_staff() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select to_jsonb(a), a.user_id into _before, _uid from public.addresses a where a.id = _address_id;
  if _before is null then raise exception 'Address not found'; end if;
  delete from public.addresses where id = _address_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'customer_address_delete', 'addresses', _address_id, _before, null);
  return true;
end $$;

revoke all on function public.staff_upsert_customer_address(uuid,uuid,text,text,text,text,text,numeric,numeric,boolean) from public, anon;
revoke all on function public.staff_delete_customer_address(uuid) from public, anon;
grant execute on function public.staff_upsert_customer_address(uuid,uuid,text,text,text,text,text,numeric,numeric,boolean) to authenticated;
grant execute on function public.staff_delete_customer_address(uuid) to authenticated;