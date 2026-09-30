CREATE OR REPLACE FUNCTION public.staff_courier_reassign_rider(_order_id uuid, _expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _before jsonb; _o public.courier_orders%rowtype; _err text; _name text;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'Rider can only be assigned before pickup (current status: %)', _o.status;
  end if;
  if _o.status = 'REQUESTED' and coalesce(_o.payment_status,'pending') = 'pending' then
    raise exception 'Payment is not complete for this order yet, so a rider cannot be assigned';
  end if;
  if _o.assigned_expert_id = _expert_id and _o.status not in ('REQUESTED','SEARCHING') then
    raise exception 'This rider is already assigned'; end if;
  _err := public.staff_courier_rider_ok(_order_id, _expert_id);
  if _err is not null then raise exception '%', _err; end if;
  _before := to_jsonb(_o);

  perform set_config('app.courier_actor_type','staff',true);
  perform set_config('app.courier_actor_id', auth.uid()::text, true);

  update public.courier_orders
     set assigned_expert_id=_expert_id, assigned_at=now(), needs_ops_attention=false,
         status = case when status in ('REQUESTED','SEARCHING') then 'DRIVER_ASSIGNED' else status end
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