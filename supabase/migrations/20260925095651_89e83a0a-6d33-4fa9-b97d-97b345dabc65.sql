CREATE OR REPLACE FUNCTION public.staff_courier_rider_ok(_order_id uuid, _expert_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _o public.courier_orders%rowtype; _skill uuid; _st text;
begin
  select * into _o from public.courier_orders where id=_order_id;
  select status into _st from public.experts where id=_expert_id;
  if _st is null then return 'Rider not found'; end if;
  if _st <> 'active' then return 'Rider is not active'; end if;
  select required_skill into _skill from public.courier_vehicle_types where id=_o.vehicle_type_id;
  if _skill is not null and not exists (select 1 from public.partner_skills where expert_id=_expert_id and status='approved' and service_category_id=_skill) then
    return 'Rider is not approved for this vehicle type'; end if;
  if _o.required_skill_id is not null and not exists (select 1 from public.partner_skills where expert_id=_expert_id and status='approved' and service_category_id=_o.required_skill_id) then
    return 'Rider does not have the courier skill'; end if;
  if exists (select 1 from public.courier_orders c where c.assigned_expert_id=_expert_id and c.id<>_order_id
             and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')) then
    return 'Rider is already on another courier job'; end if;
  if exists (select 1 from public.bookings b where b.assigned_expert_id=_expert_id and b.deleted_at is null
             and b.status in ('expert_assigned','in_progress')) then
    return 'Rider is on an active booking'; end if;
  return null;
end $$;
REVOKE ALL ON FUNCTION public.staff_courier_rider_ok(uuid,uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_courier_reassign_rider(_order_id uuid, _expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _before jsonb; _o public.courier_orders%rowtype; _err text; _name text;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status not in ('SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'Rider can only be assigned before pickup (current status: %)', _o.status;
  end if;
  if _o.assigned_expert_id = _expert_id and _o.status <> 'SEARCHING' then
    raise exception 'This rider is already assigned'; end if;
  _err := public.staff_courier_rider_ok(_order_id, _expert_id);
  if _err is not null then raise exception '%', _err; end if;
  _before := to_jsonb(_o);

  perform set_config('app.courier_actor_type','staff',true);
  perform set_config('app.courier_actor_id', auth.uid()::text, true);

  update public.courier_orders
     set assigned_expert_id=_expert_id, assigned_at=now(), needs_ops_attention=false,
         status = case when status='SEARCHING' then 'DRIVER_ASSIGNED' else status end
   where id=_order_id;
  update public.courier_offers set status='cancelled', responded_at=now()
   where order_id=_order_id and status='pending';

  if _o.assigned_expert_id is not null and _o.assigned_expert_id <> _expert_id then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
    begin perform public.notify_expert_push(_o.assigned_expert_id,'Job reassigned','This courier job has been reassigned to another rider.','home');
    exception when others then raise warning '[reassign] %', sqlerrm; end;
  end if;
  update public.experts set is_busy=true where id=_expert_id returning name into _name;

  begin perform public.notify_expert_push(_expert_id,'New courier job assigned','A courier job has been assigned to you. Tap to view pickup details.','home');
  exception when others then raise warning '[reassign] %', sqlerrm; end;
  begin perform public.notify_customer_user_push(_o.customer_id,'Rider assigned',
    coalesce(_name,'Your rider')||' is on the way to pick up the parcel.','home');
  exception when others then raise warning '[reassign] %', sqlerrm; end;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_reassign_rider', 'courier_orders', _order_id, _before,
          (select to_jsonb(c) from public.courier_orders c where c.id=_order_id));
  return jsonb_build_object('ok', true);
end $$;

CREATE OR REPLACE FUNCTION public.staff_courier_assignable_riders(_order_id uuid)
RETURNS TABLE(id uuid, name text, phone text, is_online boolean, distance_km numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _o public.courier_orders%rowtype;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into _o from public.courier_orders where courier_orders.id=_order_id;
  return query
  select e.id, e.name::text, e.phone::text, coalesce(e.is_online,false),
         case when e.current_lat is not null and _o.pickup_lat is not null
              then round(public.haversine_km(e.current_lat,e.current_lng,_o.pickup_lat,_o.pickup_lng)::numeric,1) end
  from public.experts e
  where e.status='active' and public.staff_courier_rider_ok(_order_id, e.id) is null
  order by coalesce(e.is_online,false) desc, 5 asc nulls last, e.name
  limit 200;
end $$;
REVOKE ALL ON FUNCTION public.staff_courier_assignable_riders(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_courier_assignable_riders(uuid) TO authenticated;