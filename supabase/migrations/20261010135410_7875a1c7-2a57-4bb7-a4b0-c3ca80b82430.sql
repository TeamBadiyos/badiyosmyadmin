ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS commission_mode text NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS mrp_commission_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_commission_pct numeric NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_mrp boolean NOT NULL DEFAULT false;
ALTER TABLE public.merchant_order_items ADD COLUMN IF NOT EXISTS is_mrp_snapshot boolean NOT NULL DEFAULT false;
ALTER TABLE public.merchant_orders ADD COLUMN IF NOT EXISTS commission_breakdown jsonb;

CREATE OR REPLACE FUNCTION public.store_commission_snapshot(_merchant_id uuid, _items_total numeric, _mrp_total numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare _m record; _gst_on boolean; _gst_pct numeric; _mrp numeric; _oth numeric;
  _mp numeric; _op numeric; _ma numeric; _oa numeric; _amt numeric; _gst numeric;
begin
  select commission_mode, mrp_commission_pct, other_commission_pct into _m from public.merchants where id = _merchant_id;
  if coalesce(_m.commission_mode,'flat') <> 'split' then
    return public.store_commission_snapshot(_merchant_id, _items_total);
  end if;
  _mrp := least(greatest(coalesce(_mrp_total,0),0), coalesce(_items_total,0));
  _oth := coalesce(_items_total,0) - _mrp;
  _mp := least(greatest(coalesce(_m.mrp_commission_pct,0),0),50);
  _op := least(greatest(coalesce(_m.other_commission_pct,0),0),50);
  _ma := round(_mrp*_mp/100.0,2); _oa := round(_oth*_op/100.0,2); _amt := _ma + _oa;
  _gst_on := public.store_setting('store_commission_gst_enabled', 0) >= 1;
  _gst_pct := case when _gst_on then greatest(public.store_setting('store_commission_gst_pct', 18), 0) else 0 end;
  _gst := round(_amt*_gst_pct/100.0,2);
  return jsonb_build_object(
    'commission_pct', case when coalesce(_items_total,0) > 0 then round(_amt*100.0/_items_total,2) else 0 end,
    'commission_amount', _amt, 'commission_gst_pct', _gst_pct, 'commission_gst_amount', _gst,
    'merchant_net', greatest(round(coalesce(_items_total,0)-_amt-_gst,2),0),
    'breakdown', jsonb_build_object('mode','split','mrp_total',_mrp,'mrp_pct',_mp,'mrp_amount',_ma,
       'other_total',_oth,'other_pct',_op,'other_amount',_oa));
end $$;

CREATE OR REPLACE FUNCTION public.staff_set_merchant_commission_mode(_merchant_id uuid, _mode text, _mrp_pct numeric, _other_pct numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _uid uuid := auth.uid(); _before jsonb; _after jsonb;
begin
  if _uid is null or not public.is_active_staff(_uid, array['super_admin']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if _mode not in ('flat','split') then raise exception 'invalid_mode'; end if;
  if _mode = 'split' and (_mrp_pct is null or _other_pct is null or _mrp_pct<0 or _mrp_pct>50 or _other_pct<0 or _other_pct>50) then
    raise exception 'commission_out_of_range' using errcode='22023'; end if;
  select jsonb_build_object('commission_mode',commission_mode,'mrp_commission_pct',mrp_commission_pct,'other_commission_pct',other_commission_pct)
    into _before from public.merchants where id=_merchant_id;
  if _before is null then raise exception 'merchant_not_found'; end if;
  update public.merchants set commission_mode=_mode,
    mrp_commission_pct=case when _mode='split' then _mrp_pct else mrp_commission_pct end,
    other_commission_pct=case when _mode='split' then _other_pct else other_commission_pct end, updated_at=now()
   where id=_merchant_id;
  _after := jsonb_build_object('commission_mode',_mode,'mrp_commission_pct',_mrp_pct,'other_commission_pct',_other_pct);
  insert into public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  values (_uid,'set_merchant_commission_mode','merchants',_merchant_id,_before,_after);
  return jsonb_build_object('ok',true);
end $$;
REVOKE ALL ON FUNCTION public.staff_set_merchant_commission_mode(uuid,text,numeric,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_merchant_commission_mode(uuid,text,numeric,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.store_commission_snapshot(uuid,numeric,numeric) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.store_create_order(_merchant_id uuid, _items jsonb, _address_id uuid, _payment_mode text DEFAULT 'online'::text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid(); _m record; _addr record; _it jsonb; _p record;
  _qty int; _items_total numeric := 0; _fee numeric; _quote jsonb;
  _order_id uuid; _num text; _count int := 0; _phone text; _name text;
  _want text; _prev record; _reused boolean := false; _exp int; _comm jsonb; _mrp_total numeric := 0;
begin
  if _uid is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty_cart'); end if;
  if coalesce(_payment_mode,'online') <> 'online' then
    return jsonb_build_object('ok', false, 'code', 'online_only'); end if;

  select * into _m from public.public_stores where id = _merchant_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'store_unavailable'); end if;
  if coalesce(_m.is_open_now,false) = false or coalesce(_m.is_accepting_orders,false) = false then
    return jsonb_build_object('ok', false, 'code', 'store_closed'); end if;

  select * into _addr from public.addresses where id = _address_id and user_id = _uid;
  if not found then return jsonb_build_object('ok', false, 'code', 'bad_address'); end if;

  _quote := public.store_courier_fare(_merchant_id, _addr.latitude, _addr.longitude);
  if not coalesce((_quote->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(_quote->>'code','delivery_unavailable')); end if;
  _fee := (_quote->>'delivery_fee')::numeric;

  select string_agg(pid || ':' || q, ',' order by pid) into _want from (
    select (e->>'product_id') as pid, sum(greatest(1, least(50, coalesce((e->>'quantity')::int, 1)))) as q
      from jsonb_array_elements(_items) e group by 1) s;
  _exp := public.store_setting('store_unpaid_expiry_minutes', 10)::int;
  for _prev in select o.id, o.order_number,
        (select string_agg(i.product_id::text || ':' || i.quantity, ',' order by i.product_id::text)
           from public.merchant_order_items i where i.order_id = o.id) as sig
      from public.merchant_orders o
     where o.user_id = _uid and o.merchant_id = _merchant_id and o.status = 'pending'
       and o.payment_mode = 'online' and coalesce(o.payment_status,'pending') = 'pending'
       and o.created_at >= now() - make_interval(mins => _exp)
     order by o.created_at desc for update
  loop
    if not _reused and _prev.sig = _want then
      _reused := true; _order_id := _prev.id; _num := _prev.order_number;
    else
      update public.merchant_orders set cancel_reason = 'PAYMENT_NOT_COMPLETED' where id = _prev.id;
      perform public.store_set_status(_prev.id, 'cancelled', 'store_unpaid_replaced', jsonb_build_object('reason','PAYMENT_NOT_COMPLETED'));
    end if;
  end loop;

  select phone, full_name into _phone, _name from public.users where id = _uid;

  if _reused then
    delete from public.merchant_order_items where order_id = _order_id;
    update public.merchant_orders set address_id = _address_id,
      delivery_address = nullif(btrim(concat_ws(', ', nullif(_addr.full_address,''), nullif(_addr.area,''), nullif(_addr.city,''))), ''),
      delivery_lat = _addr.latitude, delivery_lng = _addr.longitude, customer_phone = _phone, customer_name = _name,
      customer_note = nullif(btrim(coalesce(_note,'')), ''), delivery_quote = _quote, updated_at = now()
     where id = _order_id;
  else
    _order_id := gen_random_uuid();
    _num := 'BS' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || lpad((floor(random()*100000))::int::text, 5, '0');
    insert into public.merchant_orders (id, merchant_id, user_id, order_number, status, total_amount,
      address_id, delivery_address, delivery_lat, delivery_lng, customer_phone, customer_name,
      payment_mode, payment_status, items_total, delivery_fee, customer_note, source, delivery_quote)
    values (_order_id, _merchant_id, _uid, _num, 'pending', 0, _address_id,
      nullif(btrim(concat_ws(', ', nullif(_addr.full_address,''), nullif(_addr.area,''), nullif(_addr.city,''))), ''),
      _addr.latitude, _addr.longitude, _phone, _name, 'online', 'pending', 0, 0,
      nullif(btrim(coalesce(_note,'')), ''), 'customer_app', _quote);
  end if;

  for _it in select * from jsonb_array_elements(_items) loop
    _qty := greatest(1, least(50, coalesce((_it->>'quantity')::int, 1)));
    select p.id, p.name, p.price, p.stock_quantity, coalesce(p.is_mrp,false) as is_mrp into _p from public.products p
      join public.public_products pp on pp.id = p.id
     where p.id = (_it->>'product_id')::uuid and p.merchant_id = _merchant_id;
    if not found then raise exception 'product_unavailable'; end if;
    if coalesce(_p.stock_quantity,0) < _qty then raise exception 'out_of_stock'; end if;
    insert into public.merchant_order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity, is_mrp_snapshot)
    values (_order_id, _p.id, _p.name, _p.price, _qty, _p.is_mrp);
    if _p.is_mrp then _mrp_total := _mrp_total + (_p.price * _qty); end if;
    _items_total := _items_total + (_p.price * _qty); _count := _count + 1;
  end loop;
  if _count = 0 then raise exception 'empty_cart'; end if;
  if _items_total < public.store_setting('store_min_order_amount', 0) then raise exception 'below_min_order'; end if;

  _comm := public.store_commission_snapshot(_merchant_id, _items_total, _mrp_total);

  update public.merchant_orders set items_total = _items_total, delivery_fee = _fee,
         total_amount = _items_total + _fee,
         commission_pct        = (_comm->>'commission_pct')::numeric,
         commission_amount     = (_comm->>'commission_amount')::numeric,
         commission_gst_pct    = (_comm->>'commission_gst_pct')::numeric,
         commission_gst_amount = (_comm->>'commission_gst_amount')::numeric,
         merchant_net          = (_comm->>'merchant_net')::numeric,
         commission_breakdown  = _comm->'breakdown',
         updated_at = now()
   where id = _order_id;

  perform public.store_audit(_order_id, case when _reused then 'store_order_reused' else 'store_order_created' end, null,
    jsonb_build_object('status','pending','total', _items_total + _fee, 'delivery_fee', _fee, 'commission', _comm));

  return jsonb_build_object('ok', true, 'order_id', _order_id, 'order_number', _num, 'reused', _reused,
    'items_total', _items_total, 'delivery_fee', _fee, 'total_amount', _items_total + _fee, 'payment_mode', 'online');
exception when others then
  return jsonb_build_object('ok', false, 'code', split_part(sqlerrm, ':', 1), 'detail', sqlerrm);
end $function$;