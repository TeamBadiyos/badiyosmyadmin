alter table public.bulk_dispatch_plans add column if not exists cost_per_extra_trip numeric;

drop function if exists public.staff_upsert_dispatch_plan(uuid,text,boolean,boolean,integer,boolean,time without time zone[],integer,boolean,integer);

create or replace function public.staff_upsert_dispatch_plan(_id uuid, _name text, _manual_enabled boolean, _qty_enabled boolean, _qty_threshold integer, _slots_enabled boolean, _slot_times time without time zone[], _max_drops_per_batch integer, _is_active boolean DEFAULT true, _time_per_drop_min integer DEFAULT 3, _cost_per_extra_trip numeric DEFAULT null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _old jsonb; _new public.bulk_dispatch_plans;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if _id is null then
    insert into public.bulk_dispatch_plans(name,manual_enabled,qty_enabled,qty_threshold,slots_enabled,slot_times,max_drops_per_batch,is_active,time_per_drop_min,cost_per_extra_trip)
    values (btrim(_name),coalesce(_manual_enabled,false),coalesce(_qty_enabled,false),_qty_threshold,coalesce(_slots_enabled,false),coalesce(_slot_times,'{}'),_max_drops_per_batch,coalesce(_is_active,true),coalesce(_time_per_drop_min,3),_cost_per_extra_trip)
    returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_dispatch_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.dispatch_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_dispatch_plans set name=btrim(_name),manual_enabled=coalesce(_manual_enabled,false),qty_enabled=coalesce(_qty_enabled,false),
      qty_threshold=_qty_threshold,slots_enabled=coalesce(_slots_enabled,false),slot_times=coalesce(_slot_times,'{}'),
      max_drops_per_batch=_max_drops_per_batch,is_active=coalesce(_is_active,true),time_per_drop_min=coalesce(_time_per_drop_min,3),cost_per_extra_trip=_cost_per_extra_trip where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_dispatch_plan','bulk_dispatch_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $function$;

revoke all on function public.staff_upsert_dispatch_plan(uuid,text,boolean,boolean,integer,boolean,time without time zone[],integer,boolean,integer,numeric) from public, anon;
grant execute on function public.staff_upsert_dispatch_plan(uuid,text,boolean,boolean,integer,boolean,time without time zone[],integer,boolean,integer,numeric) to authenticated, service_role;