-- 1. Policy keys + default text
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
    'clean_cancel_policy','wash_cancel_policy','store_cancel_policy','food_cancel_policy'] $$;

CREATE OR REPLACE FUNCTION public.default_store_cancel_policy()
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
 SELECT jsonb_build_object(
  'en', jsonb_build_array(
    'Cancel before the shop accepts your order: full refund.',
    'Once the shop accepts, the order can''t be cancelled from the app — contact Help.',
    'If the shop rejects the order, no rider is found or delivery fails: full refund automatically.',
    'Refunds: instantly to your badiyos Wallet, or to your original payment method in 5–7 working days.'),
  'mr', jsonb_build_array(
    'दुकानाने ऑर्डर स्वीकारण्यापूर्वी रद्द केल्यास: पूर्ण परतावा.',
    'दुकानाने स्वीकारल्यानंतर ॲपमधून रद्द करता येणार नाही — Help शी संपर्क करा.',
    'दुकानाने नाकारल्यास, रायडर न मिळाल्यास किंवा डिलिव्हरी न झाल्यास: आपोआप पूर्ण परतावा.',
    'परतावा: त्वरित badiyos Wallet मध्ये, किंवा मूळ पेमेंट पद्धतीवर 5–7 कामकाजाच्या दिवसांत.')) $$;

-- Seed default city with the text
INSERT INTO public.city_ops_settings (city_id, key, value, updated_at)
SELECT public.default_city_id(), k, public.default_store_cancel_policy()::text, now()
FROM unnest(ARRAY['store_cancel_policy','food_cancel_policy']) k
ON CONFLICT (city_id, key) DO NOTHING;

-- 2. Policy for the app (store/food added; clean/wash unchanged)
CREATE OR REPLACE FUNCTION public.app_cancellation_policy(_service_key text, _city_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _g text; _c uuid := coalesce(_city_id, public.default_city_id()); _pct numeric; _ac int; _raw text; _p jsonb; _en jsonb; _mr jsonb;
BEGIN
  IF _service_key IN ('store','food') THEN
    _raw := (SELECT value FROM city_ops_settings WHERE city_id=_c AND key=_service_key||'_cancel_policy');
    IF coalesce(_raw,'')='' THEN _raw := (SELECT value FROM city_ops_settings WHERE city_id=public.default_city_id() AND key=_service_key||'_cancel_policy'); END IF;
    BEGIN _p := nullif(_raw,'')::jsonb; EXCEPTION WHEN OTHERS THEN _p := NULL; END;
    IF _p IS NULL OR jsonb_typeof(_p->'en') <> 'array' THEN _p := public.default_store_cancel_policy(); END IF;
    RETURN jsonb_build_object('service_key',_service_key,'city_id',_c,'cancel_before','accept',
      'lines_en',coalesce(_p->'en','[]'::jsonb),'lines_mr',coalesce(_p->'mr','[]'::jsonb));
  END IF;
  _g := CASE WHEN _service_key IN ('wash','clean_auto') THEN 'wash' ELSE 'clean' END;
  _pct := public.city_ops_num(_c, _g || '_cancel_fee_percent', 50);
  _ac := public.auto_cancel_minutes(_g, _c);
  _raw := public.city_ops_text(_c, _g || '_cancel_policy', '');
  BEGIN _p := nullif(_raw,'')::jsonb; EXCEPTION WHEN OTHERS THEN _p := NULL; END;
  IF _p IS NULL OR jsonb_typeof(_p->'en') <> 'array' THEN _p := public.default_cancel_policy(); END IF;
  SELECT jsonb_agg(replace(replace(x,'{fee_percent}',trim_scale(_pct)::text),'{auto_cancel_minutes}',_ac::text)) INTO _en FROM jsonb_array_elements_text(_p->'en') x;
  SELECT jsonb_agg(replace(replace(x,'{fee_percent}',trim_scale(_pct)::text),'{auto_cancel_minutes}',_ac::text)) INTO _mr FROM jsonb_array_elements_text(coalesce(_p->'mr','[]'::jsonb)) x;
  RETURN jsonb_build_object('service_key',_g,'city_id',_c,'fee_percent',_pct,
    'no_refund_after_arrived', public.city_ops_text(_c, _g || '_no_refund_after_arrived','1')='1',
    'auto_cancel_minutes',_ac,'lines_en',coalesce(_en,'[]'::jsonb),'lines_mr',coalesce(_mr,'[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.app_cancellation_policy(text,uuid) TO anon, authenticated;

-- 3. Shared full refund with destination choice
CREATE OR REPLACE FUNCTION public.store_refund_full(_order_id uuid, _destination text, _cause text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o record; _w numeric := 0; _on numeric;
BEGIN
  SELECT id, user_id, total_amount, wallet_used INTO _o FROM merchant_orders
   WHERE id=_order_id AND payment_status='paid' AND coalesce(refund_status,'none')='none' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('to_wallet',0,'to_original',0); END IF;
  _on := coalesce(_o.total_amount,0);
  IF _destination = 'wallet' THEN
    IF coalesce(_o.wallet_used,0) > 0 THEN _w := public.wallet_return(_o.user_id,'merchant_order',_o.id::text,'Shop order refund · to badiyos Wallet'); END IF;
    IF _on > 0 THEN PERFORM public.wallet_post(_o.user_id,'refund_in','cash',_on,'merchant_order',_o.id::text,'Shop order refund · to badiyos Wallet',NULL,NULL); END IF;
    UPDATE merchant_orders SET refund_status='done', refund_amount=0, refund_reason=_cause, payment_status='refunded', refunded_at=now(), updated_at=now() WHERE id=_order_id;
    PERFORM public.store_audit(_order_id,'store_refund_to_wallet',null,jsonb_build_object('reason',_cause,'wallet',_w+_on));
    RETURN jsonb_build_object('to_wallet',_w+_on,'to_original',0);
  END IF;
  _w := coalesce(_o.wallet_used,0);
  PERFORM public.store_mark_refund(_order_id,_cause);
  RETURN jsonb_build_object('to_wallet',_w,'to_original',_on);
END $$;
REVOKE ALL ON FUNCTION public.store_refund_full(uuid,text,text) FROM public, anon, authenticated;

-- 4. Customer quote + cancel
CREATE OR REPLACE FUNCTION public.app_store_cancel_quote(_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o record; _paid boolean;
BEGIN
  SELECT * INTO _o FROM merchant_orders WHERE id=_order_id AND user_id=auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('can_cancel',false,'reason_code','not_found'); END IF;
  IF _o.accepted_at IS NOT NULL OR _o.status NOT IN ('pending','paid','placed') THEN
    RETURN jsonb_build_object('can_cancel',false,'reason_code','store_accepted','message_en','Once the shop accepts, the order can''t be cancelled from the app — contact Help.','message_mr','दुकानाने स्वीकारल्यानंतर ॲपमधून रद्द करता येणार नाही — Help शी संपर्क करा.');
  END IF;
  _paid := _o.payment_status='paid';
  RETURN jsonb_build_object('can_cancel',true,'reason_code',null,
    'refund_total', CASE WHEN _paid THEN coalesce(_o.total_amount,0)+coalesce(_o.wallet_used,0) ELSE 0 END,
    'wallet_part', CASE WHEN _paid THEN coalesce(_o.wallet_used,0) ELSE 0 END,
    'online_part', CASE WHEN _paid THEN coalesce(_o.total_amount,0) ELSE 0 END,
    'destinations', jsonb_build_array('wallet','original'));
END $$;
GRANT EXECUTE ON FUNCTION public.app_store_cancel_quote(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.app_store_cancel_quote(uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION public.app_store_cancel_order(_order_id uuid, _destination text DEFAULT 'original', _reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o record; _r jsonb := '{"to_wallet":0,"to_original":0}';
BEGIN
  SELECT * INTO _o FROM merchant_orders WHERE id=_order_id AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF _o.accepted_at IS NOT NULL OR _o.status NOT IN ('pending','paid','placed') THEN RETURN jsonb_build_object('ok',false,'code','too_late'); END IF;
  UPDATE merchant_orders SET cancel_reason=coalesce(nullif(btrim(coalesce(_reason,'')),''),'CUSTOMER_CANCELLED') WHERE id=_order_id;
  PERFORM public.store_set_status(_order_id,'cancelled','store_customer_cancel',jsonb_build_object('reason',_reason,'destination',_destination));
  IF _o.payment_status='paid' THEN
    PERFORM public.store_restock(_order_id);
    _r := public.store_refund_full(_order_id, CASE WHEN _destination='wallet' THEN 'wallet' ELSE 'original' END, 'customer_cancel');
  END IF;
  RETURN jsonb_build_object('ok',true,'refund_total',(_r->>'to_wallet')::numeric+(_r->>'to_original')::numeric,
    'to_wallet',(_r->>'to_wallet')::numeric,'to_original',(_r->>'to_original')::numeric);
END $$;
GRANT EXECUTE ON FUNCTION public.app_store_cancel_order(uuid,text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.app_store_cancel_order(uuid,text,text) FROM anon, public;

-- old app entry keeps working, same rules
CREATE OR REPLACE FUNCTION public.store_cancel_order(_order_id uuid, _reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r jsonb;
BEGIN
  _r := public.app_store_cancel_order(_order_id,'original',_reason);
  IF (_r->>'ok')::boolean THEN RETURN jsonb_build_object('ok',true,'refund',(_r->>'refund_total')::numeric>0); END IF;
  RETURN _r;
END $$;

-- 5. Staff cancel: full / partial / none, reason required
DROP FUNCTION IF EXISTS public.staff_store_cancel_refund(uuid, text);
CREATE FUNCTION public.staff_store_cancel_refund(_order_id uuid, _reason text, _mode text DEFAULT 'full', _amount numeric DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _o public.merchant_orders%rowtype; _c record; _max numeric; _a numeric; _wc numeric; _wb numeric; _toW numeric := 0; _on numeric := 0; _left numeric;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _mode NOT IN ('full','partial','none') THEN RAISE EXCEPTION 'Pick full, partial or no refund'; END IF;
  SELECT * INTO _o FROM merchant_orders WHERE id=_order_id FOR UPDATE;
  IF _o.id IS NULL OR _o.status IN ('delivered','completed','cancelled','rejected') THEN RAISE EXCEPTION 'order_not_cancellable'; END IF;
  _max := CASE WHEN _o.payment_status='paid' THEN coalesce(_o.total_amount,0)+coalesce(_o.wallet_used,0) ELSE 0 END;
  IF _mode='partial' AND (_amount IS NULL OR _amount <= 0 OR _amount > _max) THEN RAISE EXCEPTION 'Refund amount must be between ₹1 and ₹%', _max; END IF;
  SELECT id, status INTO _c FROM courier_orders WHERE id=_o.courier_order_id;
  IF _c.id IS NOT NULL AND _c.status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') THEN
    PERFORM set_config('app.courier_actor_type','staff',true);
    UPDATE courier_orders SET status='CANCELLED', cancelled_by='staff', cancelled_at=now(), cancel_reason_code='store_order_cancelled' WHERE id=_c.id;
    UPDATE courier_offers SET status='cancelled' WHERE order_id=_c.id AND status='pending';
  END IF;
  UPDATE merchant_orders SET cancel_reason=btrim(_reason), needs_attention=false WHERE id=_o.id;
  PERFORM public.store_set_status(_o.id,'cancelled','staff_store_cancel_refund',jsonb_build_object('reason',btrim(_reason),'mode',_mode,'amount',_amount));
  IF _c.id IS NULL OR _c.status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP','CANCELLED') THEN PERFORM public.store_restock(_o.id); END IF;
  IF _o.payment_status <> 'paid' OR _mode='none' THEN
    INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
    VALUES (auth.uid(),'store_order.cancel_no_refund','merchant_orders',_o.id,to_jsonb(_o),jsonb_build_object('mode',_mode,'reason',_reason));
    RETURN jsonb_build_object('ok',true,'to_wallet',0,'to_original',0);
  END IF;
  IF _mode='full' OR _amount >= _max THEN
    PERFORM public.store_mark_refund(_o.id,'staff_cancelled');
    _toW := coalesce(_o.wallet_used,0); _on := coalesce(_o.total_amount,0);
  ELSE
    -- partial: wallet part first (cash, then bonus), then online
    SELECT coalesce(-sum(amount) FILTER (WHERE bucket='cash'),0), coalesce(-sum(amount) FILTER (WHERE bucket='bonus'),0) INTO _wc, _wb
      FROM customer_wallet_ledger WHERE user_id=_o.user_id AND ref_type='merchant_order' AND ref_id=_o.id::text;
    _left := _amount;
    IF least(_wc,_left) > 0 THEN PERFORM wallet_post(_o.user_id,'refund_in','cash',least(_wc,_left),'merchant_order',_o.id::text,'Shop order part refund · to badiyos Wallet',NULL,auth.uid()); _toW := least(_wc,_left); _left := _left-_toW; END IF;
    IF least(_wb,_left) > 0 THEN PERFORM wallet_post(_o.user_id,'bonus','bonus',least(_wb,_left),'merchant_order',_o.id::text,'Shop order part refund · to badiyos Wallet',now()+make_interval(days=>public.wallet_bonus_days()),auth.uid()); _toW := _toW+least(_wb,_left); _left := _amount-_toW; END IF;
    _on := least(_left, coalesce(_o.total_amount,0));
    IF _on > 0 THEN
      UPDATE merchant_orders SET refund_status='refund_pending', refund_amount=_on, refund_reason='staff_partial', refund_next_attempt_at=now(), payment_status='refund_pending', updated_at=now() WHERE id=_o.id;
      PERFORM public.store_dispatch_refund_job();
    ELSE
      UPDATE merchant_orders SET refund_status='done', refund_amount=0, refund_reason='staff_partial', payment_status='refunded', refunded_at=now(), updated_at=now() WHERE id=_o.id;
    END IF;
  END IF;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'store_order.cancel_refund','merchant_orders',_o.id,to_jsonb(_o),jsonb_build_object('mode',_mode,'amount',_amount,'to_wallet',_toW,'to_original',_on,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'to_wallet',_toW,'to_original',_on);
END $$;
REVOKE ALL ON FUNCTION public.staff_store_cancel_refund(uuid,text,text,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_store_cancel_refund(uuid,text,text,numeric) TO authenticated;

-- 6. Delivery failed / no rider -> automatic full refund
CREATE OR REPLACE FUNCTION public.store_sync_from_courier()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _cur text;
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
    update public.merchant_orders set cancel_reason = case when NEW.status='FAILED_DELIVERY' then 'DELIVERY_FAILED' else 'NO_RIDER_FOUND' end,
           needs_attention = false where id = NEW.store_order_id;
    perform public.store_set_status(NEW.store_order_id, 'cancelled', 'store_auto_cancel_' || lower(NEW.status), jsonb_build_object('reason', NEW.cancel_reason_code));
    if NEW.status = 'CANCELLED' then perform public.store_restock(NEW.store_order_id); end if;
    perform public.store_mark_refund(NEW.store_order_id, case when NEW.status='FAILED_DELIVERY' then 'DELIVERY_FAILED' else 'NO_RIDER_FOUND' end);
  elsif NEW.status = 'CANCELLED' then
    update public.merchant_orders set needs_attention = true where id = NEW.store_order_id;
    perform public.store_set_status(NEW.store_order_id, 'needs_attention', 'courier_' || lower(NEW.status),
      jsonb_build_object('reason', NEW.cancel_reason_code));
    perform public.admin_alert_enqueue('store_attention', NEW.store_order_id, 'Store delivery problem', null, NEW.total_amount, 'Now');
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.courier_sweeper()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _r record; _timeout int; _expire int; _delay int; _step numeric; _max numeric; _store_cancel int;
begin
  begin
    _timeout := public.courier_setting('courier_search_timeout_minutes', 5)::int;
    _expire  := public.courier_setting('courier_unpaid_expire_minutes', 15)::int;
    _delay   := public.courier_setting('courier_settlement_delay_minutes', 0)::int;
    _store_cancel := public.courier_setting('store_no_rider_cancel_minutes', 15)::int;
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
         and _r.search_started_at < now() - make_interval(mins => _store_cancel) then
        -- shop order: no rider found -> cancel; trigger refunds the customer in full
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