ALTER TABLE public.merchant_orders
  ADD COLUMN IF NOT EXISTS merchant_pay_on_failure boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merchant_pay_off_reason text,
  ADD COLUMN IF NOT EXISTS failure_cause text;

CREATE OR REPLACE FUNCTION public.city_ops_keys()
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT ARRAY['slot_capacity_enabled','slot_capacity_mode','default_slot_capacity','wash_default_slot_capacity',
    'clean_band_morning_end','clean_band_day_end','wash_band_morning_end','wash_band_day_end',
    'slot_first_start_hour','slot_last_start_hour','slot_step_minutes',
    'instant_booking_enabled','wash_instant_booking_enabled',
    'clean_auto_cancel_minutes','wash_auto_cancel_minutes',
    'clean_last_slot_before_close_minutes','wash_last_slot_before_close_minutes',
    'clean_cancel_fee_percent','wash_cancel_fee_percent',
    'clean_no_refund_after_arrived','wash_no_refund_after_arrived',
    'clean_cancel_policy','wash_cancel_policy','store_cancel_policy','food_cancel_policy',
    'store_no_rider_cancel_minutes','food_no_rider_cancel_minutes'] $$;

-- per-order no-rider limit: order city, else default city, else 30
CREATE OR REPLACE FUNCTION public.store_no_rider_minutes(_store_order_id uuid)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    (SELECT nullif(trim(both '"' from s.value),'')::int FROM city_ops_settings s WHERE s.city_id=o.city_id AND s.key=k),
    (SELECT nullif(trim(both '"' from s.value),'')::int FROM city_ops_settings s WHERE s.city_id=public.default_city_id() AND s.key=k),
    30)
  FROM merchant_orders o JOIN merchants m ON m.id=o.merchant_id,
       LATERAL (SELECT (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)||'_no_rider_cancel_minutes' k) x
  WHERE o.id=_store_order_id $$;
REVOKE ALL ON FUNCTION public.store_no_rider_minutes(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.courier_sweeper()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _r record; _timeout int; _expire int; _delay int; _step numeric; _max numeric;
begin
  begin
    _timeout := public.courier_setting('courier_search_timeout_minutes', 5)::int;
    _expire  := public.courier_setting('courier_unpaid_expire_minutes', 15)::int;
    _delay   := public.courier_setting('courier_settlement_delay_minutes', 0)::int;
    select coalesce(radius_expand_step_km,1), coalesce(radius_expand_max_km,10) into _step, _max from public.dispatch_config limit 1;
    _step := coalesce(_step,1); _max := coalesce(_max,10);

    update public.courier_offers set status='expired', responded_at=now() where status='pending' and expires_at <= now();

    for _r in select id, customer_id from public.courier_orders
               where status='REQUESTED' and payment_status='pending' and created_at < now() - make_interval(mins => _expire)
    loop
      perform set_config('app.courier_actor_type','system',true);
      update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='unpaid_expired' where id=_r.id;
    end loop;

    for _r in select id, customer_id, search_started_at, current_search_radius_km, store_order_id, needs_ops_attention, total_amount, source
                from public.courier_orders where status='SEARCHING'
    loop
      if _r.search_started_at is not null and _r.store_order_id is not null
         and _r.search_started_at < now() - make_interval(mins => public.store_no_rider_minutes(_r.store_order_id)) then
        perform set_config('app.courier_actor_type','system',true);
        update public.courier_offers set status='cancelled' where order_id=_r.id and status='pending';
        update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='no_rider_found' where id=_r.id;
      elsif _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout)
         and _r.store_order_id is not null then
        if not coalesce(_r.needs_ops_attention,false) then
          update public.courier_orders set needs_ops_attention = true where id = _r.id;
          update public.merchant_orders set needs_attention = true where id = _r.store_order_id;
          perform public.store_audit(_r.store_order_id, 'store_no_expert_found', null, jsonb_build_object('courier_order_id', _r.id));
          perform public.admin_alert_enqueue('store_no_expert', _r.store_order_id, 'Store order - no Expert found', null, _r.total_amount, 'Now');
        end if;
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          perform public.courier_dispatch_next(_r.id);
        end if;
      elsif _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout)
         and _r.source = 'business' then
        if not coalesce(_r.needs_ops_attention,false) then
          update public.courier_orders set needs_ops_attention = true where id = _r.id;
        end if;
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          update public.courier_orders set current_search_radius_km = least(_max, coalesce(current_search_radius_km, 5) + _step) where id=_r.id;
          perform public.courier_dispatch_next(_r.id);
        end if;
      elsif _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout) then
        perform set_config('app.courier_actor_type','system',true);
        update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='no_rider_found' where id=_r.id;
        update public.courier_offers set status='cancelled' where order_id=_r.id and status='pending';
        perform public.courier_mark_refund_pending(_r.id, (select total_amount from public.courier_orders where id=_r.id), 'no_rider_found');
        perform public.notify_customer_user_push(_r.customer_id, 'No rider available', 'We could not find a rider. Your payment is being refunded.', 'home');
      else
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          update public.courier_orders set current_search_radius_km = least(_max, coalesce(current_search_radius_km, 5) + _step) where id=_r.id;
          perform public.courier_dispatch_next(_r.id);
        end if;
      end if;
    end loop;

    for _r in select id from public.courier_orders
               where status='DELIVERED' and earnings_credited_at is null and delivered_at < now() - make_interval(mins => _delay)
    loop
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper failed: %', sqlerrm;
  end;
  perform public.store_sweeper();
end $function$;

-- failure after accept: merchant still earns
CREATE OR REPLACE FUNCTION public.store_sync_from_courier()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _cur text; _cause text;
begin
  if NEW.store_order_id is null or NEW.status is not distinct from OLD.status then return NEW; end if;
  select status into _cur from public.merchant_orders where id = NEW.store_order_id;
  if _cur in ('rejected','cancelled','delivered','completed') then return NEW; end if;
  if NEW.status = 'DRIVER_ASSIGNED' then
    if _cur = 'ready' then
      perform public.store_audit(NEW.store_order_id, 'courier_expert_assigned', jsonb_build_object('status', _cur),
        jsonb_build_object('status', _cur, 'expert_id', NEW.assigned_expert_id));
    else
      perform public.store_set_status(NEW.store_order_id, 'expert_assigned', 'courier_expert_assigned', jsonb_build_object('expert_id', NEW.assigned_expert_id));
    end if;
    update public.merchant_orders set needs_attention = false where id = NEW.store_order_id;
  elsif NEW.status = 'SEARCHING' and OLD.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    if _cur <> 'ready' then
      perform public.store_set_status(NEW.store_order_id, 'accepted', 'courier_expert_released');
    end if;
  elsif NEW.status = 'PICKED_UP' then
    perform public.store_set_status(NEW.store_order_id, 'picked_up', 'courier_pickup_otp_verified');
    update public.merchant_orders set picked_up_at = coalesce(picked_up_at, now()) where id = NEW.store_order_id;
  elsif NEW.status = 'DELIVERED' then
    perform public.store_set_status(NEW.store_order_id, 'delivered', 'courier_delivery_otp_verified');
    update public.merchant_orders set delivered_at = coalesce(delivered_at, now()) where id = NEW.store_order_id;
  elsif NEW.status = 'FAILED_DELIVERY' or (NEW.status = 'CANCELLED' and NEW.cancel_reason_code = 'no_rider_found') then
    _cause := case when NEW.status='FAILED_DELIVERY' then 'DELIVERY_FAILED' else 'NO_RIDER_FOUND' end;
    update public.merchant_orders set cancel_reason = _cause, failure_cause = _cause, needs_attention = false,
           merchant_pay_on_failure = (accepted_at is not null and payment_status = 'paid' and not coalesce(is_training,false))
     where id = NEW.store_order_id;
    perform public.store_set_status(NEW.store_order_id, 'cancelled', 'store_auto_cancel_' || lower(NEW.status), jsonb_build_object('reason', NEW.cancel_reason_code));
    if NEW.status = 'CANCELLED' and not exists (select 1 from merchant_orders where id=NEW.store_order_id and merchant_pay_on_failure) then
      perform public.store_restock(NEW.store_order_id);
    end if;
    perform public.store_mark_refund(NEW.store_order_id, _cause);
  elsif NEW.status = 'CANCELLED' then
    update public.merchant_orders set needs_attention = true where id = NEW.store_order_id;
    perform public.store_set_status(NEW.store_order_id, 'needs_attention', 'courier_' || lower(NEW.status),
      jsonb_build_object('reason', NEW.cancel_reason_code));
    perform public.admin_alert_enqueue('store_attention', NEW.store_order_id, 'Store delivery problem', null, NEW.total_amount, 'Now');
  end if;
  return NEW;
end $function$;

-- merchant ledger: sale lines also for paid-on-failure orders; no refund line for them
CREATE OR REPLACE FUNCTION public.ledger_post_order(_o merchant_orders)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE g numeric; d numeric; k text := _o.id::text; at timestamptz := coalesce(_o.delivered_at,_o.cancelled_at,_o.updated_at);
  _pof boolean := coalesce(_o.merchant_pay_on_failure,false);
BEGIN
  IF (_o.status='delivered' AND _o.payment_status='paid') OR _pof THEN
    g := coalesce(_o.item_total,_o.items_total,0);
    PERFORM public.ledger_post(_o.merchant_id,'sale',g,'sale:'||k,at,_o.id,NULL,NULL,_o.order_number);
    PERFORM public.ledger_post(_o.merchant_id,'commission',-coalesce(_o.commission_amount,0),'comm:'||k,at,_o.id,NULL,NULL,_o.order_number);
    PERFORM public.ledger_post(_o.merchant_id,'commission_gst',-coalesce(_o.commission_gst,0),'cgst:'||k,at,_o.id,NULL,NULL,_o.order_number);
    PERFORM public.ledger_post(_o.merchant_id,'tcs',-coalesce(_o.tcs_amount,0),'tcs:'||k,at,_o.id,NULL,NULL,_o.order_number);
    PERFORM public.ledger_post(_o.merchant_id,'tds',-coalesce(_o.tds_amount,0),'tds:'||k,at,_o.id,NULL,NULL,_o.order_number);
    IF _o.merchant_net IS NOT NULL THEN
      d := _o.merchant_net - (g-coalesce(_o.commission_amount,0)-coalesce(_o.commission_gst,0)-coalesce(_o.tcs_amount,0)-coalesce(_o.tds_amount,0));
      IF abs(d) >= 0.01 THEN PERFORM public.ledger_post(_o.merchant_id,'adjustment',d,'net:'||k,at,_o.id,NULL,NULL,'Order net reconciliation'); END IF;
    END IF;
    IF NOT _pof AND coalesce(_o.refund_status,'none') IN ('refund_pending','processing','done')
       AND NOT EXISTS (SELECT 1 FROM public.merchant_settlement_items i WHERE i.order_id=_o.id) THEN
      PERFORM public.ledger_post(_o.merchant_id,'refund',-coalesce(_o.merchant_net,g),'refund:'||k,coalesce(_o.refunded_at,now()),_o.id,NULL,NULL,_o.order_number);
    END IF;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.merchant_orders_ledger_on_complete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _net numeric; _comm jsonb; _base numeric; _pof boolean;
begin
  if coalesce(NEW.is_training,false) then return NEW; end if;
  _pof := coalesce(NEW.merchant_pay_on_failure,false) and not coalesce(OLD.merchant_pay_on_failure,false);
  if not _pof then
    if NEW.status not in ('completed','delivered') then return NEW; end if;
    if coalesce(OLD.status,'') in ('completed','delivered') then return NEW; end if;
    if coalesce(NEW.payment_status,'') not in ('paid') then return NEW; end if;
    if coalesce(NEW.refund_status,'none') not in ('none') then return NEW; end if;
  end if;
  if coalesce(NEW.merchant_net,0) > 0 then
    _net := NEW.merchant_net;
  else
    _base := case when NEW.courier_order_id is not null then coalesce(NEW.items_total,0) else coalesce(NEW.total_amount,0) end;
    _comm := public.store_commission_snapshot(NEW.merchant_id, _base);
    _net := (_comm->>'merchant_net')::numeric;
  end if;
  if _net > 0 then
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
    values ('merchant', NEW.merchant_id, _net, 'credit', 'order:' || NEW.id::text, 'earnings')
    on conflict (owner_type, owner_id, reason) where owner_type = 'merchant' do nothing;
  end if;
  if not _pof then
    begin
      perform public.evaluate_reward_triggers('merchant', NEW.merchant_id, 'order_completed', NEW.id::text,
        jsonb_build_object('order_id', NEW.id, 'amount', coalesce(NEW.total_amount,0)));
    exception when others then raise warning '[merchant order reward] %', sqlerrm;
    end;
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_orders_ledger_reversal()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _credit numeric;
begin
  if coalesce(NEW.merchant_pay_on_failure,false) then return NEW; end if;
  if coalesce(NEW.refund_status,'none') <> 'done' then return NEW; end if;
  if coalesce(OLD.refund_status,'none') = 'done' then return NEW; end if;
  select amount into _credit from public.wallet_ledger
   where owner_type = 'merchant' and owner_id = NEW.merchant_id and reason = 'order:' || NEW.id::text and type = 'credit';
  if _credit is null or _credit <= 0 then return NEW; end if;
  insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
  values ('merchant', NEW.merchant_id, _credit, 'debit', 'order_refund_reversal:' || NEW.id::text, 'earnings')
  on conflict (owner_type, owner_id, reason) where owner_type = 'merchant' do nothing;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.merchant_orders_refund_adjustment()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT coalesce(NEW.merchant_pay_on_failure,false) AND NEW.refund_status = 'done' AND OLD.refund_status IS DISTINCT FROM 'done'
     AND EXISTS (SELECT 1 FROM public.merchant_settlement_items msi WHERE msi.order_id = NEW.id) THEN
    INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount)
    VALUES (NEW.merchant_id, NEW.id, -abs(coalesce(NEW.merchant_net,0)))
    ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $function$;

-- settlements include paid-on-failure orders
CREATE OR REPLACE FUNCTION public.settlement_eligible(o merchant_orders, _cutoff timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT (
    (o.status='delivered' AND o.delivered_at < _cutoff AND o.payment_status='paid'
      AND coalesce(o.refund_status,'none') NOT IN ('refund_pending','processing','done','failed'))
    OR (coalesce(o.merchant_pay_on_failure,false) AND o.status='cancelled' AND o.cancelled_at < _cutoff))
   AND NOT EXISTS (SELECT 1 FROM public.merchant_settlement_items i WHERE i.order_id=o.id) $$;

CREATE OR REPLACE FUNCTION public.settlement_build(_store_id uuid, _cutoff timestamp with time zone, _type text, _run_date date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _fee_gst numeric := 0; _sid uuid; _t record; _adj numeric; _fee numeric := 0; _pct numeric; _inv text[]; _net numeric; _pay numeric; _rem numeric := 0; _s public.merchant_settlements;
BEGIN
  SELECT count(*) c, min(coalesce(o.delivered_at,o.cancelled_at))::date f, max(coalesce(o.delivered_at,o.cancelled_at))::date t,
         coalesce(sum(coalesce(o.item_total,o.items_total)),0) g, coalesce(sum(o.commission_amount),0) cm,
         coalesce(sum(o.commission_gst),0) cg, coalesce(sum(o.tcs_amount),0) tc, coalesce(sum(o.tds_amount),0) td,
         coalesce(sum(o.merchant_net),0) n
    INTO _t
    FROM public.merchant_orders o
   WHERE o.merchant_id=_store_id AND public.settlement_eligible(o, _cutoff);
  SELECT coalesce(sum(a.amount),0) INTO _adj FROM public.merchant_settlement_adjustments a WHERE a.store_id=_store_id AND a.settlement_id IS NULL;
  IF _t.c = 0 AND _adj = 0 THEN RETURN NULL; END IF;
  _net := round(_t.n + _adj, 2);
  IF _type='instant' AND _net > 0 THEN
    SELECT coalesce(m.instant_settlement_fee_pct,0) INTO _pct FROM public.merchants m WHERE m.id=_store_id;
    _fee := round(_net * _pct / 100, 2);
    _fee_gst := round(_fee * public.tax_rate('instant_fee_gst') / 100, 2);
  END IF;
  IF _net < 0 THEN _pay := 0;
  ELSIF _type='instant' THEN _pay := round(_net-_fee-_fee_gst,2);
  ELSE _pay := floor(_net/100)*100; _rem := round(_net-_pay,2);
  END IF;
  _inv := public.settlement_next_invoice(coalesce(_run_date, (now() AT TIME ZONE 'Asia/Kolkata')::date));
  INSERT INTO public.merchant_settlements(store_id,type,period_from,period_to,gross_amount,commission_total,commission_gst_total,
     tcs_total,tds_total,instant_fee,instant_fee_gst,net_amount,status,adjustment_total,invoice_no,invoice_fy,run_date)
  VALUES (_store_id,_type,_t.f,_t.t,_t.g,_t.cm,_t.cg,_t.tc,_t.td,_fee,_fee_gst,_pay,
     CASE WHEN _pay <= 0 THEN 'carry_forward' WHEN _type='instant' THEN 'approved' ELSE 'draft' END,
     _adj,_inv[1],_inv[2],_run_date)
  RETURNING * INTO _s;
  _sid := _s.id;
  INSERT INTO public.merchant_settlement_items(settlement_id,order_id)
  SELECT _sid, o.id FROM public.merchant_orders o
   WHERE o.merchant_id=_store_id AND public.settlement_eligible(o, _cutoff);
  UPDATE public.merchant_settlement_adjustments a SET settlement_id=_sid WHERE a.store_id=_store_id AND a.settlement_id IS NULL;
  IF _net < 0 THEN
    INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason, settlement_id)
    VALUES (_store_id, NULL, _net, 'carry_forward from ' || _inv[1], NULL);
  ELSIF _rem > 0 THEN
    INSERT INTO public.merchant_settlement_adjustments(store_id, order_id, amount, reason, settlement_id)
    VALUES (_store_id, NULL, _rem, 'round_off carried forward from ' || _inv[1], NULL);
  END IF;
  PERFORM public.ledger_post_settlement(_s);
  RETURN _sid;
END $function$;

-- staff switch: stop paying the merchant for a failed order
CREATE OR REPLACE FUNCTION public.staff_set_merchant_pay_on_failure(_order_id uuid, _on boolean, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o merchant_orders; _credit numeric; _g numeric;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _on THEN RAISE EXCEPTION 'Pay merchant can only be switched off'; END IF;
  SELECT * INTO _o FROM merchant_orders WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND OR NOT _o.merchant_pay_on_failure THEN RAISE EXCEPTION 'Pay merchant is already off for this order'; END IF;
  IF EXISTS (SELECT 1 FROM merchant_settlement_items WHERE order_id=_order_id) THEN RAISE EXCEPTION 'Already settled to the merchant — can''t switch off'; END IF;
  UPDATE merchant_orders SET merchant_pay_on_failure=false, merchant_pay_off_reason=btrim(_reason), updated_at=now() WHERE id=_order_id;
  SELECT amount INTO _credit FROM wallet_ledger WHERE owner_type='merchant' AND owner_id=_o.merchant_id AND reason='order:'||_o.id::text AND type='credit';
  IF coalesce(_credit,0) > 0 THEN
    INSERT INTO wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
    VALUES ('merchant', _o.merchant_id, _credit, 'debit', 'order_refund_reversal:'||_o.id::text, 'earnings')
    ON CONFLICT (owner_type, owner_id, reason) WHERE owner_type='merchant' DO NOTHING;
  END IF;
  _g := coalesce(_o.item_total,_o.items_total,0);
  PERFORM public.ledger_post(_o.merchant_id,'refund',-coalesce(_o.merchant_net,_g),'refund:'||_o.id::text,now(),_o.id,NULL,NULL,_o.order_number);
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'store_order.merchant_pay_off','merchant_orders',_order_id,
          jsonb_build_object('merchant_pay_on_failure',true),jsonb_build_object('merchant_pay_on_failure',false,'reason',btrim(_reason)));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.staff_set_merchant_pay_on_failure(uuid,boolean,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_merchant_pay_on_failure(uuid,boolean,text) TO authenticated;

-- P&L: delivery failure refunds are a badiyos cost
CREATE OR REPLACE FUNCTION public.staff_dashboard_money(_from date, _to date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata');
        _t timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
        _res jsonb := '{}'::jsonb; _g text; _r record; _rf numeric; _re numeric; _dfr numeric;
BEGIN
  IF NOT public.is_active_staff(public.cc_uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  FOREACH _g IN ARRAY ARRAY['clean','wash'] LOOP
    SELECT coalesce(sum(coalesce(price,0)),0) gross, coalesce(sum(coalesce(discount_amount,0)),0) disc, count(*) n, coalesce(sum(coalesce(price,0)-coalesce(snapshot_expert_payout,0)-coalesce(snapshot_partner_payout,0)),0) earn
      INTO _r FROM public.bookings b
     WHERE coalesce(b.is_training,false)=false AND b.deleted_at IS NULL
       AND coalesce(b.paid_at, CASE WHEN b.razorpay_payment_id IS NOT NULL THEN b.created_at END) >= _f
       AND coalesce(b.paid_at, CASE WHEN b.razorpay_payment_id IS NOT NULL THEN b.created_at END) < _t
       AND public.booking_capacity_group(b.service_category_id, b.service_label)=_g;
    SELECT coalesce(sum(coalesce(refund_amount,0)),0),
            coalesce(sum(CASE WHEN coalesce(total_amount,0)>0 THEN (coalesce(price,0)-coalesce(snapshot_expert_payout,0)-coalesce(snapshot_partner_payout,0))*least(refund_amount/total_amount,1) ELSE 0 END),0) INTO _rf, _re
      FROM public.bookings b
     WHERE coalesce(b.is_training,false)=false AND b.refund_status='refunded' AND coalesce(b.refund_amount,0)>0
       AND coalesce(b.cancelled_at,b.updated_at) >= _f AND coalesce(b.cancelled_at,b.updated_at) < _t
       AND public.booking_capacity_group(b.service_category_id, b.service_label)=_g;
    _res := _res || jsonb_build_object(CASE WHEN _g='clean' THEN 'maid' ELSE 'wash' END,
      jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'refund',round(_rf,2),'net',round(_r.gross-_r.disc-_rf,2),'orders',_r.n,'earning',round(_r.earn-_re,2)));
  END LOOP;
  FOREACH _g IN ARRAY ARRAY['store','food'] LOOP
    SELECT coalesce(sum(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)),0) gross,
           coalesce(sum(greatest(coalesce(o.items_total,o.item_total,0)+coalesce(o.delivery_fee,0)+coalesce(o.platform_fee,0)
              +coalesce(o.gst_items,0)+coalesce(o.gst_delivery,0)+coalesce(o.gst_platform,0)-coalesce(o.total_amount,0)-coalesce(o.wallet_used,0),0)),0) disc, count(*) n,
           coalesce(sum(coalesce(o.commission_amount,0)+greatest(coalesce(o.delivery_fee,0)-coalesce(o.rider_share_amount,0),0)+coalesce(o.platform_fee,0)),0) earn
      INTO _r FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g AND coalesce(o.is_training,false)=false
       AND o.paid_at >= _f AND o.paid_at < _t;
    -- normal refunds (merchant not paid): earning share reversed
    SELECT coalesce(sum(coalesce(o.refund_amount,0)),0),
           coalesce(sum(CASE WHEN coalesce(o.total_amount,0)+coalesce(o.wallet_used,0)>0 THEN (coalesce(o.commission_amount,0)+greatest(coalesce(o.delivery_fee,0)-coalesce(o.rider_share_amount,0),0)+coalesce(o.platform_fee,0))*least((coalesce(o.refund_amount,0)+coalesce(o.wallet_used,0))/(coalesce(o.total_amount,0)+coalesce(o.wallet_used,0)),1) ELSE 0 END),0) INTO _rf, _re
      FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g AND coalesce(o.is_training,false)=false
       AND NOT coalesce(o.merchant_pay_on_failure,false)
       AND (coalesce(o.refund_amount,0)>0 OR (o.refund_status='done' AND coalesce(o.wallet_used,0)>0)) AND o.refunded_at >= _f AND o.refunded_at < _t;
    -- delivery failure refunds (merchant still paid): whole refund is a badiyos cost
    SELECT coalesce(sum(coalesce(o.refund_amount,0)+coalesce(o.wallet_used,0)),0) INTO _dfr
      FROM public.merchant_orders o JOIN public.merchants m ON m.id=o.merchant_id
     WHERE (CASE WHEN m.service_type='food' THEN 'food' ELSE 'store' END)=_g AND coalesce(o.is_training,false)=false
       AND coalesce(o.merchant_pay_on_failure,false) AND o.refund_status='done' AND o.refunded_at >= _f AND o.refunded_at < _t;
    _res := _res || jsonb_build_object(_g, jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'refund',round(_rf+_dfr,2),
      'delivery_failure_refunds',round(_dfr,2),'net',round(_r.gross-_r.disc-_rf-_dfr,2),'orders',_r.n,'earning',round(_r.earn-_re-_dfr,2)));
  END LOOP;
  SELECT coalesce(sum(coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0)+coalesce(platform_fee,0)),0) gross,
         coalesce(sum(coalesce(discount_amount,0)),0) disc, count(*) n,
         coalesce(sum((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))*coalesce(commission_pct,0)/100+coalesce(platform_fee,0)),0) earn
    INTO _r FROM public.courier_orders
   WHERE merchant_order_id IS NULL AND (payment_status='paid' OR razorpay_payment_id IS NOT NULL)
     AND created_at>=_f AND created_at<_t;
  SELECT coalesce(sum(coalesce(refund_amount,0)),0),
         coalesce(sum(CASE WHEN coalesce(total_amount,0)>0 THEN ((coalesce(base_amount,0)+coalesce(extra_fee,0)+coalesce(stops_fee,0))*coalesce(commission_pct,0)/100+coalesce(platform_fee,0))*least(refund_amount/total_amount,1) ELSE 0 END),0) INTO _rf, _re
    FROM public.courier_orders
   WHERE merchant_order_id IS NULL AND coalesce(refund_amount,0)>0
     AND coalesce(cancelled_at,updated_at)>=_f AND coalesce(cancelled_at,updated_at)<_t;
  _res := _res || jsonb_build_object('parcel', jsonb_build_object('gross',round(_r.gross,2),'discount',round(_r.disc,2),'refund',round(_rf,2),'net',round(_r.gross-_r.disc-_rf,2),'orders',_r.n,'earning',round(_r.earn-_re,2)));
  RETURN _res;
END $function$;