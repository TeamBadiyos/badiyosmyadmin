-- Run as database owner. Every rider action, notification and wallet change rolls back.
DO $test$
DECLARE _id uuid; _uid uuid; _pickup uuid; _drop uuid; _last uuid; _r jsonb;
 _before jsonb; _packets jsonb; _secrets jsonb; _proofs bigint; _blocked boolean; _s record;
BEGIN
 SELECT o.id,e.auth_user_id INTO _id,_uid FROM public.gift_trips g
 JOIN public.courier_orders o ON o.id=g.courier_order_id JOIN public.experts e ON e.id=o.assigned_expert_id
 WHERE e.auth_user_id IS NOT NULL ORDER BY g.created_at DESC LIMIT 1;
 IF _id IS NULL THEN RAISE EXCEPTION 'Test requires a historical assigned gifting trip'; END IF;
 BEGIN
  -- Clone the historical trip into a transaction-only fixture; never reset a live order.
  PERFORM set_config('app.courier_skip_default_stops','on',true);
  INSERT INTO public.courier_orders SELECT (jsonb_populate_record(NULL::public.courier_orders,
   to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'status','SEARCHING','cancelled_at',NULL,'delivered_at',NULL,'completed_at',NULL,'is_training',true))).*
  FROM public.courier_orders o WHERE o.id=_id RETURNING id INTO _drop;
  INSERT INTO public.gift_trips(campaign_id,merchant_id,trip_no,courier_order_id)
  SELECT campaign_id,merchant_id,(SELECT coalesce(max(trip_no),0)+1 FROM public.gift_trips),_drop FROM public.gift_trips WHERE courier_order_id=_id LIMIT 1;
  INSERT INTO public.courier_order_stops(order_id,stop_type,sequence,lat,lng,address,contact_name,contact_phone)
  SELECT _drop,stop_type,sequence,lat,lng,address,contact_name,contact_phone FROM public.courier_order_stops WHERE order_id=_id AND stop_type IN ('pickup','drop');
  INSERT INTO public.courier_order_parcels(order_id,pickup_stop_id,drop_stop_id,description)
  SELECT _drop,pick.id,d.id,'Rolled-back gifting test' FROM public.courier_order_stops d
  CROSS JOIN LATERAL (SELECT id FROM public.courier_order_stops WHERE order_id=_drop AND stop_type='pickup' ORDER BY sequence LIMIT 1) pick
  WHERE d.order_id=_drop AND d.stop_type='drop';
  _id:=_drop;
  UPDATE public.courier_orders SET status='DRIVER_ASSIGNED' WHERE id=_id;
  SELECT jsonb_build_object('base',base_amount,'gst',gst_amount,'total',total_amount,'fare',fare_breakdown,'rider',assigned_expert_id) INTO _before FROM public.courier_orders WHERE id=_id;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO _packets FROM public.business_trip_packets p WHERE courier_order_id=_id;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stop_id) INTO _secrets FROM public.courier_stop_secrets s JOIN public.courier_order_stops st ON st.id=s.stop_id WHERE st.order_id=_id;
  SELECT count(*) INTO _proofs FROM public.business_delivery_proofs WHERE courier_order_id=_id;
  SELECT id INTO _pickup FROM public.courier_order_stops WHERE order_id=_id AND stop_type='pickup' ORDER BY sequence LIMIT 1;
  SELECT id INTO _last FROM public.courier_order_stops WHERE order_id=_id AND stop_type='drop' ORDER BY sequence DESC LIMIT 1;

  -- Only the assigned authenticated rider can act.
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  _blocked:=false;
  BEGIN PERFORM public.courier_verify_stop_otp(_pickup,'',NULL); EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Unassigned caller completed gifting pickup'; END IF;
  PERFORM set_config('request.jwt.claim.sub',_uid::text,true);
  _blocked:=false;
  BEGIN PERFORM public.courier_verify_stop_otp(_last,'',NULL); EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Later stop completed before pickup'; END IF;

  -- No QR packets, OTP, proof or location is required in the rider contract.
  _r:=public.courier_trip_packets(_id);
  IF _r->>'delivery_mode'<>'route_only' OR _r->'packets'<>'[]'::jsonb
   OR (_r->>'requires_scan')::boolean OR (_r->>'requires_otp')::boolean
   OR (_r->>'requires_proof')::boolean OR (_r->>'requires_geofence')::boolean
   OR _r->>'drop_proof_mode'<>'none' THEN RAISE EXCEPTION 'Incorrect route-only contract: %',_r; END IF;
  IF public.business_create_trip_packets((SELECT batch_id FROM public.gift_trips WHERE courier_order_id=_id LIMIT 1),_id)<>0 THEN RAISE EXCEPTION 'Gifting generated QR packets'; END IF;
  _r:=public.courier_verify_stop_otp(_pickup,'',NULL);
  IF NOT coalesce((_r->>'ok')::boolean,false) OR _r->>'order_status'<>'IN_TRANSIT' THEN RAISE EXCEPTION 'No-OTP pickup failed: %',_r; END IF;
  _blocked:=false;
  BEGIN PERFORM public.courier_verify_stop_otp(_last,'',NULL); EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Route allowed skipping an earlier drop'; END IF;

  FOR _s IN SELECT id FROM public.courier_order_stops WHERE order_id=_id AND stop_type='drop' AND status='pending' ORDER BY sequence LOOP
   IF public.business_stop_proof_mode(_s.id)<>'none' THEN RAISE EXCEPTION 'Gifting stop still requires proof'; END IF;
   _r:=public.courier_complete_drop_with_proof(_s.id,'{}',NULL,NULL,NULL,NULL);
   IF NOT coalesce((_r->>'ok')::boolean,false) THEN RAISE EXCEPTION 'No-proof drop completion failed: %',_r; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE id=_s.id AND status='completed' AND completed_via='manual') THEN RAISE EXCEPTION 'Stop completion not recorded as manual'; END IF;
   IF EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=_id AND stop_type='drop' AND status='pending') THEN
    IF (SELECT status FROM public.courier_orders WHERE id=_id)<>'IN_TRANSIT' THEN RAISE EXCEPTION 'Trip closed before all stops'; END IF;
    _r:=public.courier_verify_stop_otp(_s.id,'',NULL);
    IF NOT coalesce((_r->>'already_completed')::boolean,false) THEN RAISE EXCEPTION 'Completed stop retry is not idempotent'; END IF;
   END IF;
  END LOOP;
  IF (SELECT status FROM public.courier_orders WHERE id=_id) NOT IN ('DELIVERED','COMPLETED') THEN RAISE EXCEPTION 'Trip not delivered after all stops'; END IF;
  IF _before IS DISTINCT FROM (SELECT jsonb_build_object('base',base_amount,'gst',gst_amount,'total',total_amount,'fare',fare_breakdown,'rider',assigned_expert_id) FROM public.courier_orders WHERE id=_id) THEN RAISE EXCEPTION 'Fare or rider changed'; END IF;
  IF _packets IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.business_trip_packets p WHERE courier_order_id=_id) THEN RAISE EXCEPTION 'QR scan records were falsified'; END IF;
  IF _secrets IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stop_id) FROM public.courier_stop_secrets s JOIN public.courier_order_stops st ON st.id=s.stop_id WHERE st.order_id=_id) THEN RAISE EXCEPTION 'OTP verification or issuance recorded for route-only completion'; END IF;
  IF _proofs<>(SELECT count(*) FROM public.business_delivery_proofs WHERE courier_order_id=_id) THEN RAISE EXCEPTION 'Unexpected proof created'; END IF;
  RAISE EXCEPTION USING errcode='ZX001',message='rollback successful gifting test';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN RAISE NOTICE 'PASS: assigned rider, sequential multi-drop completion, no QR/OTP/proof/geofence, unchanged fares, no false verification records; all actions rolled back';
 END;
END $test$;

DO $test$
DECLARE _id uuid; _uid uuid; _s uuid; _r jsonb; _blocked boolean;
BEGIN
 SELECT o.id,e.auth_user_id,s.id INTO _id,_uid,_s FROM public.courier_orders o
 JOIN public.experts e ON e.id=o.assigned_expert_id JOIN public.courier_order_stops s ON s.order_id=o.id
 WHERE NOT public.courier_is_gifting_order(o.id) AND o.source='business' AND e.auth_user_id IS NOT NULL LIMIT 1;
 IF _id IS NULL THEN RAISE EXCEPTION 'Test requires an ordinary assigned business trip'; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',_uid::text,true);
  _r:=public.courier_trip_packets(_id);
  IF _r->>'delivery_mode'='route_only' OR _r->>'drop_proof_mode'='none' THEN RAISE EXCEPTION 'Ordinary business trip exempted'; END IF;
  _blocked:=false;
  BEGIN PERFORM public.courier_rider_complete_gifting_stop(_s); EXCEPTION WHEN insufficient_privilege THEN _blocked:=true; END;
  IF NOT _blocked THEN RAISE EXCEPTION 'Ordinary business trip accepted by gifting completion'; END IF;
  RAISE EXCEPTION USING errcode='ZX001',message='rollback ordinary trip probe';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN RAISE NOTICE 'PASS: ordinary business trips retain proof rules and cannot use gifting completion; probe rolled back'; END;
END $test$;