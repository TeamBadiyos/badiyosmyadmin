CREATE OR REPLACE FUNCTION public.staff_set_merchant_modules(_merchant_id uuid, _store_enabled boolean, _delivery_enabled boolean, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ declare _b jsonb;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_reason),'')='' then raise exception 'Reason is required'; end if;
  select jsonb_build_object('store_enabled',store_enabled,'delivery_enabled',delivery_enabled) into _b from public.merchants where id=_merchant_id for update;
  if _b is null then raise exception 'Merchant not found'; end if;
  update public.merchants set store_enabled=_store_enabled, delivery_enabled=_delivery_enabled, updated_at=now() where id=_merchant_id;
  perform public.business_audit('staff_set_merchant_modules','merchants',_merchant_id,_b,
    jsonb_build_object('store_enabled',_store_enabled,'delivery_enabled',_delivery_enabled,'reason',_reason),null);
end $function$;

UPDATE public.merchants SET store_enabled=false, updated_at=now()
WHERE store_name='Shree Store' AND deleted_at IS NULL AND status='approved';