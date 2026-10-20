-- Run as database owner. Fixtures and queued pushes roll back within each test.
DO $test$
DECLARE _e uuid; _other uuid; _actor uuid; _city uuid; _opt uuid; _b jsonb; _id uuid; _failed boolean;
BEGIN
 SELECT id, city_id INTO _e,_city FROM public.experts WHERE mode='TRAINING' AND status='active' AND NOT coalesce(is_busy,false) LIMIT 1;
 SELECT id INTO _other FROM public.experts WHERE mode='TRAINING' AND status='active' AND id<>_e LIMIT 1;
 SELECT auth_user_id INTO _actor FROM public.staff_users WHERE role='super_admin' AND status='active' LIMIT 1;
 IF _e IS NULL OR _other IS NULL OR _actor IS NULL THEN RAISE EXCEPTION 'Test requires two training experts and active admin'; END IF;
 FOR _opt IN SELECT o.id FROM public.service_price_options o JOIN public.services s ON s.id=o.service_id WHERE o.is_active AND s.is_active ORDER BY o.id LIMIT 2 LOOP
  BEGIN
   _b:=public.staff_create_training_broadcast(_opt,NULL,NULL,(SELECT value::jsonb FROM public.ops_settings WHERE key='training_address'),ARRAY[_e],_actor,ARRAY[_city]);
   _id:=(_b->>'id')::uuid;
   IF _b->>'status'<>'accepted' OR _b->>'assigned_expert_id' IS NOT NULL THEN RAISE EXCEPTION 'Training order was directly assigned or not broadcast'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.booking_broadcast_pings WHERE booking_id=_id AND expert_id=_e) OR EXISTS(SELECT 1 FROM public.booking_broadcast_pings WHERE booking_id=_id AND expert_id<>_e) THEN RAISE EXCEPTION 'Broadcast recipients differ from selected names'; END IF;
   IF public.booking_expert_mode_ok(_id,_other) THEN RAISE EXCEPTION 'Unselected expert can claim'; END IF;
   PERFORM set_config('request.jwt.claim.sub',(SELECT auth_user_id::text FROM public.experts WHERE id=_other),true);
   _failed:=false;
   BEGIN PERFORM public.claim_booking_as_expert(_id); EXCEPTION WHEN OTHERS THEN _failed:=true; END;
   IF NOT _failed THEN RAISE EXCEPTION 'Unselected claim succeeded'; END IF;
   PERFORM set_config('request.jwt.claim.sub',(SELECT auth_user_id::text FROM public.experts WHERE id=_e),true);
   PERFORM public.claim_booking_as_expert(_id);
   IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=_id AND assigned_expert_id=_e AND status='expert_assigned') THEN RAISE EXCEPTION 'Selected acceptance failed'; END IF;
   RAISE EXCEPTION USING errcode='ZX001',message='rollback test fixture';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
 END LOOP;
END $test$;

DO $test$
DECLARE _e uuid; _city uuid; _actor uuid; _m uuid; _id uuid; _cid uuid; _offer uuid; _result jsonb;
BEGIN
 SELECT id,city_id INTO _e,_city FROM public.experts WHERE mode='TRAINING' AND status='active' AND NOT coalesce(is_busy,false) LIMIT 1;
 SELECT auth_user_id INTO _actor FROM public.staff_users WHERE role='super_admin' AND status='active' LIMIT 1;
 FOR _m IN SELECT id FROM public.merchants WHERE city_id=_city AND status='approved' LIMIT 2 LOOP
  BEGIN
   INSERT INTO public.merchant_orders(merchant_id,city_id,order_number,status,source,is_training,training_expert_ids,customer_name,delivery_address,payment_status)
   VALUES(_m,_city,'TRN-ISOLATION-'||gen_random_uuid()::text,'preparing','training',true,ARRAY[_e],'Test','Training drop','pending') RETURNING id INTO _id;
   UPDATE public.merchant_orders SET status='ready' WHERE id=_id;
   SELECT courier_order_id INTO _cid FROM public.merchant_orders WHERE id=_id;
   IF _cid IS NULL THEN RAISE EXCEPTION 'Store/Food Ready did not broadcast delivery'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.courier_orders WHERE id=_cid AND is_training AND assigned_expert_id IS NULL AND status='SEARCHING') THEN RAISE EXCEPTION 'Store delivery directly assigned or not training'; END IF;
   IF (SELECT count(*) FROM public.courier_offers WHERE order_id=_cid)<>1 OR NOT EXISTS(SELECT 1 FROM public.courier_offers WHERE order_id=_cid AND expert_id=_e) THEN RAISE EXCEPTION 'Store/Food recipient isolation failed'; END IF;
   SELECT id INTO _offer FROM public.courier_offers WHERE order_id=_cid;
   PERFORM set_config('request.jwt.claim.sub',(SELECT auth_user_id::text FROM public.experts WHERE id=_e),true);
   _result:=public.courier_offer_respond(_offer,true);
   IF NOT coalesce((_result->>'accepted')::boolean,false) THEN RAISE EXCEPTION 'Store/Food rider acceptance failed: %',_result; END IF;
   RAISE EXCEPTION USING errcode='ZX001',message='rollback test fixture';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
 END LOOP;
END $test$;

DO $test$
DECLARE _e uuid; _actor uuid; _city uuid; _id uuid; _offer uuid; _v uuid; _t uuid; _result jsonb;
BEGIN
 SELECT id,city_id INTO _e,_city FROM public.experts WHERE mode='TRAINING' AND status='active' AND NOT coalesce(is_busy,false) LIMIT 1;
 SELECT auth_user_id INTO _actor FROM public.staff_users WHERE role='super_admin' AND status='active' LIMIT 1;
 SELECT id INTO _v FROM public.courier_vehicle_types LIMIT 1;
 SELECT id INTO _t FROM public.courier_types LIMIT 1;
 BEGIN
  INSERT INTO public.courier_orders(customer_id,city,city_id,vehicle_type_id,courier_type_id,pickup_lat,pickup_lng,pickup_address,pickup_contact_name,pickup_contact_phone,drop_lat,drop_lng,drop_address,drop_contact_name,drop_contact_phone,is_training,training_expert_ids,status)
  VALUES(_actor,'Latur',_city,_v,_t,18.406094,76.577344,'Training pickup','Test','9999999999',18.416094,76.587344,'Training drop','Test','9999999998',true,ARRAY[_e],'SEARCHING') RETURNING id INTO _id;
  PERFORM public.courier_dispatch_next(_id);
  IF (SELECT count(*) FROM public.courier_offers WHERE order_id=_id)<>1 OR NOT EXISTS(SELECT 1 FROM public.courier_offers WHERE order_id=_id AND expert_id=_e) THEN RAISE EXCEPTION 'Parcel recipient isolation failed'; END IF;
  SELECT id INTO _offer FROM public.courier_offers WHERE order_id=_id;
  PERFORM set_config('request.jwt.claim.sub',(SELECT auth_user_id::text FROM public.experts WHERE id=_e),true);
  _result:=public.courier_offer_respond(_offer,true);
  IF NOT coalesce((_result->>'accepted')::boolean,false) THEN RAISE EXCEPTION 'Parcel acceptance failed: %',_result; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.courier_orders WHERE id=_id AND assigned_expert_id=_e AND status='DRIVER_ASSIGNED') THEN RAISE EXCEPTION 'Parcel assigned before/without acceptance'; END IF;
  RAISE EXCEPTION USING errcode='ZX001',message='rollback test fixture';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
 END;
END $test$;