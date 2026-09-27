DROP FUNCTION IF EXISTS public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean,text,numeric);
CREATE FUNCTION public.staff_upsert_pricing_plan(_id uuid, _name text, _base_fare numeric, _included_km numeric, _per_km numeric, _min_fare numeric, _extra_drop_fee numeric, _return_per_km numeric, _commission_pct numeric, _is_active boolean DEFAULT true, _cancel_fee_type text DEFAULT 'percent'::text, _cancel_fee_value numeric DEFAULT 50, _drop_count_basis text DEFAULT 'packet')
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _old jsonb; _new public.bulk_pricing_plans;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if coalesce(_cancel_fee_type,'percent') not in ('percent','flat') then raise exception 'Fee type must be percent or flat'; end if;
  if coalesce(_drop_count_basis,'packet') not in ('packet','shop') then raise exception 'Bill drops per must be packet or shop'; end if;
  if _id is null then
    insert into public.bulk_pricing_plans(name,base_fare,included_km,per_km,min_fare,extra_drop_fee,return_per_km,commission_pct,is_active,cancel_fee_type,cancel_fee_value,drop_count_basis)
    values (btrim(_name),_base_fare,_included_km,_per_km,_min_fare,_extra_drop_fee,_return_per_km,_commission_pct,coalesce(_is_active,true),coalesce(_cancel_fee_type,'percent'),coalesce(_cancel_fee_value,50),coalesce(_drop_count_basis,'packet')) returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_pricing_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.pricing_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_pricing_plans set name=btrim(_name),base_fare=_base_fare,included_km=_included_km,per_km=_per_km,min_fare=_min_fare,
      extra_drop_fee=_extra_drop_fee,return_per_km=_return_per_km,commission_pct=_commission_pct,is_active=coalesce(_is_active,true),
      cancel_fee_type=coalesce(_cancel_fee_type,'percent'),cancel_fee_value=coalesce(_cancel_fee_value,50),
      drop_count_basis=coalesce(_drop_count_basis,'packet')
      where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_pricing_plan','bulk_pricing_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $function$;
REVOKE ALL ON FUNCTION public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean,text,numeric,text) TO authenticated, service_role;