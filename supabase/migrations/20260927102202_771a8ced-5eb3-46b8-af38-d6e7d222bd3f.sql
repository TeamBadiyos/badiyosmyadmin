ALTER TABLE public.bulk_dispatch_plans ADD COLUMN IF NOT EXISTS time_per_drop_min integer NOT NULL DEFAULT 3;

CREATE OR REPLACE FUNCTION public.bulk_dispatch_plans_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if new.time_per_drop_min is null or new.time_per_drop_min < 1 or new.time_per_drop_min > 15 then
    raise exception 'Time per drop must be between 1 and 15 minutes';
  end if;
  return new;
end $$;
DROP TRIGGER IF EXISTS bulk_dispatch_plans_validate ON public.bulk_dispatch_plans;
CREATE TRIGGER bulk_dispatch_plans_validate BEFORE INSERT OR UPDATE ON public.bulk_dispatch_plans
FOR EACH ROW EXECUTE FUNCTION public.bulk_dispatch_plans_validate();

DROP FUNCTION IF EXISTS public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean);
CREATE FUNCTION public.staff_upsert_dispatch_plan(_id uuid, _name text, _manual_enabled boolean, _qty_enabled boolean, _qty_threshold integer, _slots_enabled boolean, _slot_times time without time zone[], _max_drops_per_batch integer, _is_active boolean DEFAULT true, _time_per_drop_min integer DEFAULT 3)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _old jsonb; _new public.bulk_dispatch_plans;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if _id is null then
    insert into public.bulk_dispatch_plans(name,manual_enabled,qty_enabled,qty_threshold,slots_enabled,slot_times,max_drops_per_batch,is_active,time_per_drop_min)
    values (btrim(_name),coalesce(_manual_enabled,false),coalesce(_qty_enabled,false),_qty_threshold,coalesce(_slots_enabled,false),coalesce(_slot_times,'{}'),_max_drops_per_batch,coalesce(_is_active,true),coalesce(_time_per_drop_min,3))
    returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_dispatch_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.dispatch_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_dispatch_plans set name=btrim(_name),manual_enabled=coalesce(_manual_enabled,false),qty_enabled=coalesce(_qty_enabled,false),
      qty_threshold=_qty_threshold,slots_enabled=coalesce(_slots_enabled,false),slot_times=coalesce(_slot_times,'{}'),
      max_drops_per_batch=_max_drops_per_batch,is_active=coalesce(_is_active,true),time_per_drop_min=coalesce(_time_per_drop_min,3) where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_dispatch_plan','bulk_dispatch_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $function$;
REVOKE ALL ON FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_business_reject_trip(_batch_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _b public.business_batches%rowtype; _c public.courier_orders%rowtype; _r text := btrim(coalesce(_reason,''));
        _old jsonb; _refunded boolean := false;
begin
  perform public.business_require_ops();
  if _r = '' then raise exception 'Reason required'; end if;
  select * into _b from public.business_batches where id=_batch_id for update;
  if _b.id is null then raise exception 'Trip not found'; end if;
  if _b.status <> 'dispatched' or _b.courier_order_id is null then raise exception 'Only dispatched trips can be rejected'; end if;
  select * into _c from public.courier_orders where id=_b.courier_order_id for update;
  if _c.assigned_expert_id is not null then raise exception 'A rider is already assigned to this trip'; end if;
  if _c.status in ('CANCELLED','COMPLETED') then raise exception 'Trip is already %', lower(_c.status); end if;
  _old := to_jsonb(_b);

  update public.courier_orders set status='CANCELLED', cancelled_at=now(), cancelled_by='ops', cancel_reason_code='STAFF_REJECTED'
   where id=_c.id;
  update public.courier_offers set status='cancelled' where order_id=_c.id and status in ('pending','offered');

  update public.business_orders set status='pending', batch_id=null, batched_at=null, courier_order_id=null, parcel_id=null, drop_stop_id=null
   where batch_id=_batch_id;

  if exists (select 1 from public.wallet_ledger where owner_type='merchant' and owner_id=_b.merchant_id and wallet_type='delivery' and reason='batch:'||_c.id::text and type='debit')
     and coalesce(_b.total_amount,0) > 0 then
    perform public.business_wallet_post(_b.merchant_id, 'credit', _b.total_amount, 'batch_reject:'||_c.id::text, false, auth.uid());
    _refunded := true;
  end if;

  update public.business_batches set status='rejected', fail_reason=left('REJECTED: '||_r,200) where id=_batch_id;
  perform public.business_audit('staff_business_reject_trip','business_batches',_batch_id,_old,
    (select to_jsonb(x) from public.business_batches x where id=_batch_id), _r);
  return jsonb_build_object('ok',true,'refunded',_refunded,'amount',_b.total_amount);
end $function$;
REVOKE ALL ON FUNCTION public.staff_business_reject_trip(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_business_reject_trip(uuid, text) TO authenticated;