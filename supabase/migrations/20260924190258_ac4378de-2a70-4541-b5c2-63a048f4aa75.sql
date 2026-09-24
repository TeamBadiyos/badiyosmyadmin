drop function if exists public.staff_courier_upsert_rate(uuid, text, uuid, numeric, numeric, numeric, numeric, numeric, numeric);

create or replace function public.staff_courier_upsert_rate(
  _id uuid, _city text, _vehicle_type_id uuid, _base_fare numeric, _included_km numeric, _per_km numeric,
  _min_fare numeric, _platform_fee numeric, _commission_pct numeric,
  _customer_segment text default 'regular', _extra_pickup_fee numeric default 0, _extra_drop_fee numeric default 0,
  _max_pickups integer default 1, _max_drops integer default 1, _return_per_km numeric default 0)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _before jsonb; _rid uuid; _seg text := lower(coalesce(nullif(btrim(_customer_segment),''),'regular'));
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(btrim(_city),'') = '' then raise exception 'City required'; end if;
  if _vehicle_type_id is null then raise exception 'Vehicle type required'; end if;
  if _seg not in ('regular','corporate') then raise exception 'Invalid segment'; end if;
  if coalesce(_extra_pickup_fee,0) < 0 or coalesce(_extra_drop_fee,0) < 0 then raise exception 'Stop fees must be 0 or more'; end if;
  if coalesce(_return_per_km,0) < 0 then raise exception 'Return charge per km must be 0 or more'; end if;
  if _seg = 'regular' and (_max_pickups is null or _max_drops is null or _max_pickups < 1 or _max_drops < 1) then
    raise exception 'Regular rates need max pickups and max drops of at least 1';
  end if;
  if (_max_pickups is not null and _max_pickups < 1) or (_max_drops is not null and _max_drops < 1) then
    raise exception 'Max pickups/drops must be at least 1';
  end if;

  if _id is not null then
    select to_jsonb(r), r.id into _before, _rid from public.courier_vehicle_rates r where r.id=_id;
    if _rid is null then raise exception 'Rate not found'; end if;
    _seg := (_before->>'customer_segment');
  else
    select to_jsonb(r), r.id into _before, _rid from public.courier_vehicle_rates r
     where lower(r.city)=lower(btrim(_city)) and r.vehicle_type_id=_vehicle_type_id and r.customer_segment=_seg;
  end if;

  if _rid is null then
    insert into public.courier_vehicle_rates
      (city, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct,
       customer_segment, extra_pickup_fee, extra_drop_fee, max_pickups, max_drops, return_per_km)
    values (btrim(_city), _vehicle_type_id, coalesce(_base_fare,0), coalesce(_included_km,0),
            coalesce(_per_km,0), coalesce(_min_fare,0), coalesce(_platform_fee,0), coalesce(_commission_pct,0),
            _seg, coalesce(_extra_pickup_fee,0), coalesce(_extra_drop_fee,0), _max_pickups, _max_drops, coalesce(_return_per_km,0))
    returning id into _rid;
  else
    update public.courier_vehicle_rates set
      city=btrim(_city), vehicle_type_id=_vehicle_type_id,
      base_fare=coalesce(_base_fare,0), included_km=coalesce(_included_km,0),
      per_km=coalesce(_per_km,0), min_fare=coalesce(_min_fare,0),
      platform_fee=coalesce(_platform_fee,0), commission_pct=coalesce(_commission_pct,0),
      extra_pickup_fee=coalesce(_extra_pickup_fee,0), extra_drop_fee=coalesce(_extra_drop_fee,0),
      max_pickups=_max_pickups, max_drops=_max_drops, return_per_km=coalesce(_return_per_km,0),
      updated_at=now()
    where id=_rid;
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _before is null then 'courier_rate_create' else 'courier_rate_update' end,
          'courier_vehicle_rates', _rid, _before,
          (select to_jsonb(r) from public.courier_vehicle_rates r where r.id=_rid));
  return _rid;
end $$;
revoke all on function public.staff_courier_upsert_rate(uuid,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,integer,integer,numeric) from public, anon;
grant execute on function public.staff_courier_upsert_rate(uuid,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,integer,integer,numeric) to authenticated, service_role;

create or replace function public.staff_courier_set_setting(_key text, _value integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _before text;
begin
  if not (public.courier_is_super_admin() or public.courier_is_ops_staff()) then raise exception 'Not authorized' using errcode='42501'; end if;
  if _key not in ('courier_fail_wait_minutes','courier_return_payment_escalation_minutes') then raise exception 'Unknown setting'; end if;
  if _value is null or _value < 1 or _value > 120 then raise exception 'Value must be between 1 and 120'; end if;
  select value into _before from public.ops_settings where key=_key;
  insert into public.ops_settings(key, value, label, updated_at)
  values (_key, _value::text, case _key when 'courier_fail_wait_minutes' then 'Wait before rider can mark a stop failed (minutes)'
          else 'Escalate unpaid return charge after (minutes)' end, now())
  on conflict (key) do update set value=excluded.value, updated_at=now();
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_setting_update', 'ops_settings', null,
          jsonb_build_object('key',_key,'value',_before), jsonb_build_object('key',_key,'value',_value::text));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.staff_courier_set_setting(text,integer) from public, anon;
grant execute on function public.staff_courier_set_setting(text,integer) to authenticated, service_role;

create or replace function public.staff_courier_verify_stop(_stop_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype;
        _ndrops int; _pos int; _body text; _h jsonb; _status text;
begin
  if not public.courier_is_ops_staff() then raise exception 'Forbidden' using errcode='42501'; end if;
  if length(coalesce(btrim(_reason),'')) < 10 then raise exception 'Reason must be at least 10 characters'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _st.status <> 'arrived' then raise exception 'Stop must be in arrived state'; end if;
  if _st.stop_type = 'return' and exists (
    select 1 from public.courier_order_charges c where c.status='pending'
      and c.parcel_id in (select id from public.courier_order_parcels where return_stop_id=_stop_id)) then
    raise exception 'Collect or waive the return charge first';
  end if;

  perform set_config('app.courier_actor_type','staff',true);
  perform set_config('app.courier_actor_id', auth.uid()::text, true);

  update public.courier_stop_secrets set verified_at=now(), updated_at=now() where stop_id=_stop_id;
  update public.courier_order_stops set status='completed', completed_at=now(), updated_at=now() where id=_stop_id;

  if _st.stop_type = 'pickup' then
    update public.courier_order_parcels set status='picked', updated_at=now() where pickup_stop_id=_stop_id and status='pending';
    if _o.status = 'ARRIVED_PICKUP' then
      update public.courier_orders set status='PICKED_UP', picked_up_at=now() where id=_o.id;
    end if;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel picked up', 'Your parcel has been picked up.', 'home');
  elsif _st.stop_type = 'drop' then
    update public.courier_order_parcels set status='delivered', updated_at=now() where drop_stop_id=_stop_id and status='picked';
    select count(*) into _ndrops from public.courier_order_stops where order_id=_o.id and stop_type='drop';
    select count(*) into _pos from public.courier_order_stops where order_id=_o.id and stop_type='drop' and sequence <= _st.sequence;
    _body := case when _ndrops > 1 then format('Delivered at drop %s of %s.', _pos, _ndrops)
                  else 'Your parcel has been delivered successfully.' end;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel delivered', _body, 'home');
  else
    update public.courier_order_parcels set status='returned', updated_at=now() where return_stop_id=_stop_id and status='returning';
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel returned', 'Your parcel has been returned to the pickup point.', 'home');
  end if;

  _h := public.courier_recompute_order_progress(_o.id);
  select status into _status from public.courier_orders where id=_o.id;

  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, coalesce(_status,_o.status), coalesce(_status,_o.status), 'staff', auth.uid(),
          jsonb_build_object('event','stop_manual_verified','stop_id',_stop_id,'stop_type',_st.stop_type,'reason',_reason,'manual_verify',true));
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_stop_manual_verify', 'courier_order_stops', _stop_id,
          jsonb_build_object('status',_st.status,'order_status',_o.status),
          jsonb_build_object('status','completed','order_status',_status,'reason',_reason));
  return jsonb_build_object('ok', true, 'order_status', _status);
end $$;
revoke all on function public.staff_courier_verify_stop(uuid,text) from public, anon;
grant execute on function public.staff_courier_verify_stop(uuid,text) to authenticated, service_role;