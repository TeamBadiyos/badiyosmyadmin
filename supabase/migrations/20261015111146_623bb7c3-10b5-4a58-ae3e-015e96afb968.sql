COMMENT ON COLUMN public.service_settings.is_live IS 'UNUSED. Live/Coming Soon status comes only from public.service_flags.';
COMMENT ON COLUMN public.service_settings.timings IS 'UNUSED. Service timings come only from public.service_flags / service_hours.';
COMMENT ON COLUMN public.service_settings.delivery_min_fare IS 'Used ONLY for service food. Store/parcel use courier_vehicle_rates.';
COMMENT ON COLUMN public.service_settings.delivery_per_km IS 'Used ONLY for service food. Store/parcel use courier_vehicle_rates.';

CREATE OR REPLACE FUNCTION public.tax_rate(_key text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce((select case when is_active then rate_pct else 0 end from public.tax_settings where key = _key), 0)
$$;

-- Pure money math (rupees). Used by the bill and testable on its own.
CREATE OR REPLACE FUNCTION public.order_bill_compute(_service text, _item_total numeric, _delivery_fee numeric,
  _platform_fee numeric, _gst_platform numeric, _commission_amount numeric, _tds_applies boolean, _rider_share_pct numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare it numeric := round(coalesce(_item_total,0),2); df numeric := round(coalesce(_delivery_fee,0),2);
  gi numeric; tcs numeric; gd numeric; ca numeric; cg numeric; tds numeric; tot numeric; rs numeric; pf numeric := round(coalesce(_platform_fee,0),2);
  gp numeric := round(coalesce(_gst_platform,0),2);
begin
  if _service = 'food' then gi := round(it * public.tax_rate('food_gst_9_5')/100, 2); tcs := 0;
  else gi := 0; tcs := round(it * public.tax_rate('store_tcs')/100, 2); end if;
  gd := round(df * public.tax_rate('delivery_gst')/100, 2);
  ca := round(coalesce(_commission_amount,0), 2);
  cg := round(ca * public.tax_rate('commission_gst')/100, 2);
  tds := case when _tds_applies then round(it * public.tax_rate('tds_194o')/100, 2) else 0 end;
  tot := round(it + gi + df + gd + pf + gp, 2);
  rs := round(df * coalesce(_rider_share_pct,0)/100, 2);
  return jsonb_build_object('item_total', it, 'gst_items', gi, 'delivery_fee', df, 'gst_delivery', gd,
    'platform_fee', pf, 'gst_platform', gp, 'total_payable', tot, 'commission_amount', ca, 'commission_gst', cg,
    'tcs_amount', tcs, 'tds_amount', tds, 'rider_share_amount', rs,
    'merchant_net', round(it - ca - cg - tcs - tds, 2));
end $$;

CREATE OR REPLACE FUNCTION public.merchant_fy_gross(_merchant_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce(sum(coalesce(nullif(item_total,0), items_total, 0)), 0) from public.merchant_orders
   where merchant_id = _merchant_id and payment_status = 'paid' and status not in ('cancelled','rejected')
     and created_at >= make_timestamptz(
       extract(year from (now() at time zone 'Asia/Kolkata') - interval '3 months')::int, 4, 1, 0, 0, 0, 'Asia/Kolkata')
$$;

-- Core bill. Prices always read from DB. Raises with a code on any validation failure.
CREATE OR REPLACE FUNCTION public.order_bill_core(_merchant_id uuid, _items jsonb, _lat numeric, _lng numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _m record; _svc text; _ss record; _it jsonb; _p record; _vprice numeric; _vname text; _aprice numeric; _anames text;
  _qty int; _unit numeric; _it_total numeric := 0; _mrp_total numeric := 0; _lines jsonb := '[]'::jsonb;
  _fee numeric; _fare jsonb; _km numeric; _pf numeric := 0; _gp numeric := 0; _r record; _amt numeric;
  _comm_amt numeric; _comm_pct numeric; _snap jsonb; _tds boolean; _calc jsonb; _rates jsonb; _out jsonb; _k text; _v jsonb;
begin
  select * into _m from public.merchants where id = _merchant_id and deleted_at is null;
  if not found or _m.status <> 'approved' then raise exception 'store_unavailable'; end if;
  if coalesce(_m.is_open, true) = false then raise exception 'store_closed'; end if;
  _svc := case when _m.service_type = 'food' then 'food' else 'store' end;
  if not exists (select 1 from public.service_flags where service_key = _svc and is_active and status = 'live') then
    raise exception 'service_not_live'; end if;
  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then raise exception 'empty_cart'; end if;

  for _it in select * from jsonb_array_elements(_items) loop
    _qty := greatest(1, least(50, coalesce((_it->>'qty')::int, (_it->>'quantity')::int, 1)));
    select * into _p from public.products where id = (_it->>'product_id')::uuid;
    if not found then raise exception 'product_unavailable'; end if;
    if _p.merchant_id <> _merchant_id then raise exception 'mixed_store_cart'; end if;
    if _p.approval_status <> 'approved' or coalesce(_p.is_available,true) = false or coalesce(_p.is_active,true) = false
       or coalesce(_p.admin_hidden,false) then raise exception 'product_unavailable'; end if;
    _vprice := null; _vname := null;
    if nullif(_it->>'variant_id','') is not null then
      select price, name into _vprice, _vname from public.product_variants where id = (_it->>'variant_id')::uuid and product_id = _p.id;
      if not found then raise exception 'variant_unavailable'; end if;
    end if;
    select coalesce(sum(a.price),0), string_agg(a.name, ', ') into _aprice, _anames from public.product_addons a
     where a.product_id = _p.id and a.is_active
       and a.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(_it->'addon_ids','[]'::jsonb)) x);
    if (select count(*) from jsonb_array_elements_text(coalesce(_it->'addon_ids','[]'::jsonb))) <>
       (select count(*) from public.product_addons a where a.product_id = _p.id and a.is_active
          and a.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(_it->'addon_ids','[]'::jsonb)) x)) then
      raise exception 'addon_unavailable'; end if;
    _unit := round(coalesce(_vprice, _p.price) + _aprice, 2);
    _it_total := _it_total + round(_unit * _qty, 2);
    if coalesce(_p.is_mrp,false) then _mrp_total := _mrp_total + round(_unit * _qty, 2); end if;
    _lines := _lines || jsonb_build_object('product_id', _p.id, 'variant_id', nullif(_it->>'variant_id',''),
      'addon_ids', coalesce(_it->'addon_ids','[]'::jsonb), 'qty', _qty, 'unit_price', _unit, 'line_total', round(_unit*_qty,2),
      'is_mrp', coalesce(_p.is_mrp,false), 'stock', _p.stock_quantity,
      'name', _p.name || coalesce(' (' || _vname || ')', '') || coalesce(' + ' || _anames, ''));
  end loop;

  select * into _ss from public.service_settings where service_key = _svc;
  if _svc = 'food' then
    if _m.latitude is null or _lat is null then raise exception 'delivery_unavailable'; end if;
    _km := round(public.haversine_km(_m.latitude, _m.longitude, _lat, _lng)
           * coalesce(nullif(public.store_setting('store_courier_road_factor', 1.3),0),1.3), 2);
    if _km > public.store_max_radius_km() * 2 then raise exception 'delivery_too_far'; end if;
    _fee := round(greatest(coalesce(_ss.delivery_min_fare,0), _km * coalesce(_ss.delivery_per_km,0)), 2);
    _fare := jsonb_build_object('ok', true, 'distance_km', _km, 'distance_source', 'haversine', 'method', 'food_service_settings');
  else
    _fare := public.store_courier_fare(_merchant_id, _lat, _lng);
    if not coalesce((_fare->>'ok')::boolean,false) then raise exception '%', coalesce(_fare->>'code','delivery_unavailable'); end if;
    -- pre-GST courier fare; GST is added separately as gst_delivery
    _fee := round((_fare->>'base_amount')::numeric + coalesce((_fare->>'extra_fee')::numeric,0) + coalesce((_fare->>'platform_fee')::numeric,0), 2);
  end if;

  for _r in select * from public.fee_rules where is_active and _svc = any(service_types)
              and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) loop
    _amt := round(case when _r.amount_type = 'percent' then _it_total * _r.amount / 100 else _r.amount end, 2);
    _pf := _pf + _amt;
    _gp := _gp + round(_amt * public.tax_rate(coalesce(_r.gst_key,'platform_fee_gst')) / 100, 2);
  end loop;

  if coalesce(_m.commission_mode,'flat') = 'split' or _m.commission_pct is null then
    _snap := public.store_commission_snapshot(_merchant_id, _it_total, _mrp_total);
    _comm_amt := (_snap->>'commission_amount')::numeric; _comm_pct := (_snap->>'commission_pct')::numeric;
  else
    _comm_pct := _m.commission_pct; _comm_amt := round(_it_total * _comm_pct / 100, 2);
  end if;

  _tds := public.tax_rate('tds_194o') > 0 and public.tax_rate('tds_194o_threshold') > 0
          and public.merchant_fy_gross(_merchant_id) + _it_total > public.tax_rate('tds_194o_threshold');

  _calc := public.order_bill_compute(_svc, _it_total, _fee, _pf, _gp, _comm_amt, _tds, coalesce(_ss.rider_share_pct, 0));
  _rates := jsonb_build_object('service', _svc, 'commission_pct', _comm_pct,
    'food_gst_9_5', public.tax_rate('food_gst_9_5'), 'delivery_gst', public.tax_rate('delivery_gst'),
    'commission_gst', public.tax_rate('commission_gst'), 'platform_fee_gst', public.tax_rate('platform_fee_gst'),
    'store_tcs', public.tax_rate('store_tcs'), 'tds_194o', public.tax_rate('tds_194o'),
    'tds_194o_threshold', public.tax_rate('tds_194o_threshold'), 'tds_applied', _tds,
    'rider_share_pct', coalesce(_ss.rider_share_pct,0), 'delivery', _fare, 'commission_breakdown', _snap->'breakdown');
  _out := '{}'::jsonb;
  for _k, _v in select * from jsonb_each(_calc) loop
    if _k in ('item_total','total_payable','merchant_net') or (_v)::text::numeric > 0 then _out := _out || jsonb_build_object(_k, _v); end if;
  end loop;
  return jsonb_build_object('ok', true, 'service', _svc, 'breakdown', _out, 'full', _calc, 'commission_pct', _comm_pct,
    'mrp_total', _mrp_total, 'lines', _lines, 'tax_rates_snapshot', _rates);
end $$;
REVOKE ALL ON FUNCTION public.order_bill_core(uuid, jsonb, numeric, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_bill_compute(text, numeric, numeric, numeric, numeric, numeric, boolean, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.merchant_fy_gross(uuid) FROM public, anon, authenticated;

-- Customer-callable bill (cart preview / Bill Summary / GST Summary). Never accepts prices.
CREATE OR REPLACE FUNCTION public.calculate_order_bill(_store_id uuid, _items jsonb, _address_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
declare _a record; _r jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  select latitude, longitude into _a from public.addresses where id = _address_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'code', 'bad_address'); end if;
  _r := public.order_bill_core(_store_id, _items, _a.latitude, _a.longitude);
  return jsonb_build_object('ok', true, 'service', _r->'service', 'breakdown', _r->'breakdown',
    'items', (select jsonb_agg(jsonb_build_object('product_id', l->'product_id', 'variant_id', l->'variant_id',
       'addon_ids', l->'addon_ids', 'name', l->'name', 'qty', l->'qty', 'unit_price', l->'unit_price', 'line_total', l->'line_total'))
       from jsonb_array_elements(_r->'lines') l));
exception when others then
  return jsonb_build_object('ok', false, 'code', split_part(sqlerrm, ':', 1));
end $$;
REVOKE ALL ON FUNCTION public.calculate_order_bill(uuid, jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calculate_order_bill(uuid, jsonb, uuid) TO authenticated;

-- Order creation now uses the same server bill.
CREATE OR REPLACE FUNCTION public.store_create_order(_merchant_id uuid, _items jsonb, _address_id uuid, _payment_mode text DEFAULT 'online'::text, _note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid(); _m record; _addr record; _l jsonb; _bill jsonb; _f jsonb;
  _order_id uuid; _num text; _phone text; _name text;
  _want text; _prev record; _reused boolean := false; _exp int; _total numeric;
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

  _bill := public.order_bill_core(_merchant_id, _items, _addr.latitude, _addr.longitude);
  _f := _bill->'full';
  _total := (_f->>'total_payable')::numeric;
  if (_f->>'item_total')::numeric < public.store_setting('store_min_order_amount', 0) then raise exception 'below_min_order'; end if;
  for _l in select * from jsonb_array_elements(_bill->'lines') loop
    if coalesce((_l->>'stock')::int,0) < (_l->>'qty')::int then raise exception 'out_of_stock'; end if;
  end loop;

  select string_agg(pid || ':' || q, ',' order by pid) into _want from (
    select (l->>'product_id') as pid, sum((l->>'qty')::int) as q from jsonb_array_elements(_bill->'lines') l group by 1) s;
  _exp := public.store_setting('store_unpaid_expiry_minutes', 10)::int;
  for _prev in select o.id, o.order_number, o.total_amount,
        (select string_agg(i.product_id::text || ':' || i.quantity, ',' order by i.product_id::text)
           from public.merchant_order_items i where i.order_id = o.id) as sig
      from public.merchant_orders o
     where o.user_id = _uid and o.merchant_id = _merchant_id and o.status = 'pending'
       and o.payment_mode = 'online' and coalesce(o.payment_status,'pending') = 'pending'
       and o.created_at >= now() - make_interval(mins => _exp)
     order by o.created_at desc for update
  loop
    -- reuse only when cart and amount are identical (Razorpay order amount must match)
    if not _reused and _prev.sig = _want and _prev.total_amount = _total then
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
      customer_note = nullif(btrim(coalesce(_note,'')), ''), delivery_quote = _bill->'tax_rates_snapshot'->'delivery', updated_at = now()
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
      nullif(btrim(coalesce(_note,'')), ''), 'customer_app', _bill->'tax_rates_snapshot'->'delivery');
  end if;

  for _l in select * from jsonb_array_elements(_bill->'lines') loop
    insert into public.merchant_order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity, is_mrp_snapshot)
    values (_order_id, (_l->>'product_id')::uuid, _l->>'name', (_l->>'unit_price')::numeric, (_l->>'qty')::int, (_l->>'is_mrp')::boolean);
  end loop;

  update public.merchant_orders set
         items_total = (_f->>'item_total')::numeric, item_total = (_f->>'item_total')::numeric,
         delivery_fee = (_f->>'delivery_fee')::numeric, total_amount = _total, total_payable = _total,
         gst_items = (_f->>'gst_items')::numeric, gst_delivery = (_f->>'gst_delivery')::numeric,
         platform_fee = (_f->>'platform_fee')::numeric, gst_platform = (_f->>'gst_platform')::numeric,
         commission_pct = (_bill->>'commission_pct')::numeric, commission_pct_applied = (_bill->>'commission_pct')::numeric,
         commission_amount = (_f->>'commission_amount')::numeric,
         commission_gst_pct = public.tax_rate('commission_gst'),
         commission_gst_amount = (_f->>'commission_gst')::numeric, commission_gst = (_f->>'commission_gst')::numeric,
         tcs_amount = (_f->>'tcs_amount')::numeric, tds_amount = (_f->>'tds_amount')::numeric,
         rider_share_amount = (_f->>'rider_share_amount')::numeric, merchant_net = (_f->>'merchant_net')::numeric,
         commission_breakdown = _bill->'tax_rates_snapshot'->'commission_breakdown',
         tax_rates_snapshot = _bill->'tax_rates_snapshot', updated_at = now()
   where id = _order_id;

  perform public.store_audit(_order_id, case when _reused then 'store_order_reused' else 'store_order_created' end, null,
    jsonb_build_object('status','pending','bill', _bill->'breakdown'));

  return jsonb_build_object('ok', true, 'order_id', _order_id, 'order_number', _num, 'reused', _reused,
    'items_total', (_f->>'item_total')::numeric, 'delivery_fee', (_f->>'delivery_fee')::numeric,
    'total_amount', _total, 'breakdown', _bill->'breakdown', 'payment_mode', 'online');
exception when others then
  return jsonb_build_object('ok', false, 'code', split_part(sqlerrm, ':', 1), 'detail', sqlerrm);
end $function$;

-- Customer cancel: only before merchant accepts; paid orders get a full refund.
CREATE OR REPLACE FUNCTION public.store_cancel_order(_order_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _o record;
BEGIN
  SELECT * INTO _o FROM public.merchant_orders WHERE id = _order_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF _o.accepted_at IS NOT NULL OR _o.status NOT IN ('pending', 'paid', 'placed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_late');
  END IF;
  UPDATE public.merchant_orders SET cancel_reason = COALESCE(NULLIF(btrim(COALESCE(_reason,'')), ''), 'CUSTOMER_CANCELLED')
   WHERE id = _order_id;
  PERFORM public.store_set_status(_order_id, 'cancelled', 'store_customer_cancel', jsonb_build_object('reason', _reason));
  IF _o.payment_status = 'paid' THEN
    PERFORM public.store_restock(_order_id);
    PERFORM public.store_mark_refund(_order_id, 'customer_cancel');
  END IF;
  RETURN jsonb_build_object('ok', true, 'refund', _o.payment_status = 'paid');
END $function$;

-- Accept timeout: merchant value, else service default (food = 5).
CREATE OR REPLACE FUNCTION public.store_sweeper()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _r record;
begin
  begin perform public.store_expire_unpaid();
  exception when others then raise warning 'store_expire_unpaid failed: %', sqlerrm; end;
  begin
    for _r in select o.id from public.merchant_orders o
                join public.merchants m on m.id = o.merchant_id
                left join public.service_settings ss on ss.service_key = case when m.service_type = 'food' then 'food' else 'store' end
               where o.status in ('placed','paid') and o.payment_status = 'paid' and o.accepted_at is null
                 and coalesce(o.placed_at, o.paid_at, o.created_at)
                     < now() - make_interval(mins => coalesce(m.accept_timeout_minutes, ss.default_accept_timeout_minutes, 5))
               for update of o skip locked
    loop
      update public.merchant_orders set reject_reason = 'MERCHANT_TIMEOUT' where id = _r.id;
      perform public.store_set_status(_r.id, 'rejected', 'store_auto_reject_timeout', jsonb_build_object('reason','MERCHANT_TIMEOUT'));
      perform public.store_restock(_r.id);
      perform public.store_mark_refund(_r.id, 'MERCHANT_TIMEOUT');
    end loop;
    perform public.store_dispatch_refund_job();
  exception when others then raise warning 'store_sweeper failed: %', sqlerrm;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.cron_minute_tick()
 RETURNS void LANGUAGE plpgsql
AS $function$
begin
  begin perform public.send_completion_reminders();     exception when others then raise warning 'reminders: %', sqlerrm; end;
  begin perform public.system_check_no_accept_alerts(); exception when others then raise warning 'no-accept: %', sqlerrm; end;
  begin perform public.booking_dispatch_release_due();  exception when others then raise warning 'release: %', sqlerrm; end;
  begin perform public.booking_journey_sweeper();       exception when others then raise warning 'journey: %', sqlerrm; end;
  begin perform public.store_sweeper();                 exception when others then raise warning 'store sweeper: %', sqlerrm; end;
end $function$;