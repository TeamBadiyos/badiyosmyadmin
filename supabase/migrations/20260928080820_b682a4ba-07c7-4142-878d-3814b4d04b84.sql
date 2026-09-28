create or replace function public.staff_seal_reassign_batch(
  _batch_id uuid,
  _merchant_id uuid default null,
  _refund_amount numeric default 0,
  _charge_amount numeric default 0,
  _reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _b public.business_seal_batches%rowtype; _n int; _old uuid; _used int;
begin
  perform public.business_require_super_admin();
  select * into _b from public.business_seal_batches where id=_batch_id for update;
  if _b.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  _old := _b.merchant_id;
  if _old is null then raise exception 'BATCH_NOT_ASSIGNED'; end if;
  if _merchant_id is not null then
    if _merchant_id = _old then raise exception 'SAME_BUSINESS'; end if;
    if not exists (select 1 from public.merchants where id=_merchant_id) then raise exception 'BUSINESS_NOT_FOUND'; end if;
  end if;
  if coalesce(_refund_amount,0) < 0 or coalesce(_charge_amount,0) < 0 then raise exception 'INVALID_CHARGE'; end if;

  select count(*) into _used from public.business_seal_stickers where batch_id=_batch_id and status='used';

  if _merchant_id is null then
    update public.business_seal_stickers set merchant_id=null, status='unassigned'
      where batch_id=_batch_id and status='available';
  else
    update public.business_seal_stickers set merchant_id=_merchant_id
      where batch_id=_batch_id and status='available';
  end if;
  get diagnostics _n = row_count;
  if _n = 0 then raise exception 'NO_AVAILABLE_STICKERS'; end if;

  if coalesce(_refund_amount,0) > 0 then
    perform public.business_wallet_post(_old,'credit',_refund_amount,
      'Seal stickers batch #'||_b.batch_no||' returned',false,auth.uid());
  end if;

  if _merchant_id is not null and coalesce(_charge_amount,0) > 0 then
    begin
      perform public.business_wallet_post(_merchant_id,'debit',_charge_amount,
        'Seal stickers batch #'||_b.batch_no,false,auth.uid());
    exception when others then
      if sqlerrm like '%INSUFFICIENT_WALLET%' then raise exception 'INSUFFICIENT_WALLET'; end if;
      raise;
    end;
  end if;

  update public.business_seal_batches
    set merchant_id = _merchant_id,
        assigned_at = case when _merchant_id is null then null else now() end,
        charge_amount = case when _merchant_id is null then 0 else coalesce(_charge_amount,0) end
    where id=_batch_id;

  perform public.business_audit('staff_seal_reassign_batch','business_seal_batches',_batch_id,to_jsonb(_b),
    jsonb_build_object('from_merchant_id',_old,'to_merchant_id',_merchant_id,'moved',_n,'kept_used',_used,
      'refund_amount',coalesce(_refund_amount,0),'charge_amount',coalesce(_charge_amount,0),
      'reason',nullif(btrim(coalesce(_reason,'')),'')),'staff');

  return jsonb_build_object('ok',true,'moved',_n,'kept_used',_used);
end $$;

revoke all on function public.staff_seal_reassign_batch(uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.staff_seal_reassign_batch(uuid, uuid, numeric, numeric, text) to authenticated, service_role;