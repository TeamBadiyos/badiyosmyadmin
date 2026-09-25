CREATE OR REPLACE FUNCTION public.staff_create_business_account(_phone text, _business_name text, _city text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _ph text; _mid uuid; _before jsonb;
begin
  perform public.business_require_super_admin();
  _ph := public.business_phone10(_phone);
  if coalesce(btrim(_business_name),'')='' then raise exception 'Business name is required'; end if;
  select id, to_jsonb(m) into _mid, _before from public.merchants m
   where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=_ph
   order by (auth_user_id is not null) desc, created_at limit 1 for update;
  if _mid is null then
    insert into public.merchants(phone, store_name, city, status, onboarding_step, store_enabled, delivery_enabled, delivery_status, onboarded_by)
    values (_ph, btrim(_business_name), coalesce(nullif(btrim(_city),''),'Latur'), 'draft', 1, false, true, 'active', auth.uid())
    returning id into _mid;
  else
    update public.merchants set delivery_enabled=true, delivery_status='active', updated_at=now() where id=_mid;
  end if;
  insert into public.business_profiles(merchant_id, business_name, city)
  values (_mid, btrim(_business_name), nullif(btrim(_city),''))
  on conflict (merchant_id) do update set business_name=excluded.business_name, city=coalesce(excluded.city, business_profiles.city);
  perform public.business_audit('staff_create_business_account','merchants',_mid,_before,
    (select to_jsonb(m) from public.merchants m where id=_mid), null);
  return _mid;
end $function$;