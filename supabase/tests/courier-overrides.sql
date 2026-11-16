-- All fixture actions, notifications, billing and payouts roll back.
DO $test$
DECLARE _order uuid; _stop uuid; _pick uuid; _staff uuid; _r jsonb; _blocked boolean; _amount numeric; _before numeric;
BEGIN
 SELECT auth_user_id INTO _staff FROM staff_users WHERE role='super_admin' AND status='active' LIMIT 1;
 BEGIN
  PERFORM set_config('app.courier_skip_default_stops','on',true);
  INSERT INTO courier_orders SELECT (jsonb_populate_record(NULL::courier_orders,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'order_code',upper(substr(gen_random_uuid()::text,1,8)),'status','IN_TRANSIT','earnings_credited_at',NULL,'delivered_at',NULL,'completed_at',NULL,'is_training',true))).* FROM courier_orders o WHERE o.id='d8baf515-5e33-45ef-9795-563880c3a56c' RETURNING id INTO _order;
  IF _order IS NULL OR _staff IS NULL THEN RAISE EXCEPTION 'Fixture unavailable'; END IF;
  INSERT INTO courier_order_stops(order_id,stop_type,sequence,status) VALUES(_order,'pickup',1,'completed') RETURNING id INTO _pick;
  INSERT INTO courier_order_stops(order_id,stop_type,sequence,status) VALUES(_order,'drop',2,'pending') RETURNING id INTO _stop;
  INSERT INTO courier_order_parcels(order_id,pickup_stop_id,drop_stop_id,status) VALUES(_order,_pick,_stop,'picked');
  _blocked:=false;
  BEGIN PERFORM staff_courier_override(_order,'complete','App issue',NULL,_stop,NULL,NULL,NULL,NULL,gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Non-staff accepted'; END IF;
  _blocked:=false;
  BEGIN PERFORM staff_courier_override(_order,'complete','',NULL,_stop,NULL,NULL,NULL,NULL,_staff); EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Blank reason accepted'; END IF;
  _r:=staff_courier_override(_order,'arrive','App issue',NULL,_stop,NULL,NULL,NULL,NULL,_staff);
  _r:=staff_courier_override(_order,'undo','App issue',NULL,_stop,NULL,NULL,NULL,NULL,_staff);
  IF (SELECT status FROM courier_order_stops WHERE id=_stop)<>'pending' THEN RAISE EXCEPTION 'Undo failed'; END IF;
  _r:=staff_courier_override(_order,'arrive','App issue',NULL,_stop,NULL,NULL,NULL,NULL,_staff);
  UPDATE courier_staff_overrides SET created_at=clock_timestamp()-interval '31 minutes' WHERE order_id=_order AND action='arrive' AND undone_at IS NULL;
  _blocked:=false;
  BEGIN PERFORM staff_courier_override(_order,'undo','App issue',NULL,_stop,NULL,NULL,NULL,NULL,_staff); EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Undo after 30 minutes accepted'; END IF;
  SELECT total_amount,round((base_amount+extra_fee+coalesce(stops_fee,0))*(100-commission_pct)/100,2) INTO _before,_amount FROM courier_orders WHERE id=_order;
  _r:=staff_courier_override(_order,'complete','OTP not received',NULL,_stop,NULL,NULL,NULL,NULL,_staff);
  IF _r->>'order_status'<>'COMPLETED' THEN RAISE EXCEPTION 'Not completed: %',_r; END IF;
  IF (SELECT total_amount FROM courier_orders WHERE id=_order)<>_before THEN RAISE EXCEPTION 'Customer bill changed'; END IF;
  IF (SELECT sum(amount) FROM wallet_ledger WHERE reason='courier_order:'||_order::text) IS DISTINCT FROM _amount THEN RAISE EXCEPTION 'Payout incorrect'; END IF;
  PERFORM courier_settle_order(_order);
  IF (SELECT count(*) FROM wallet_ledger WHERE reason='courier_order:'||_order::text)<>1 THEN RAISE EXCEPTION 'Duplicate payout'; END IF;
  _blocked:=false;
  BEGIN PERFORM staff_courier_override(_order,'undo','App issue',NULL,_stop,NULL,NULL,NULL,NULL,_staff); EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Undo after payout accepted'; END IF;
  RAISE EXCEPTION USING errcode='ZX001',message='Rollback successful override test';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN RAISE NOTICE 'PASS: staff authorization, mandatory reason, 30-minute Undo, completion, unchanged billing, single normal payout, settled Undo blocked; rolled back'; END;
END $test$;