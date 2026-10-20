ALTER FUNCTION public.staff_validate_training_experts(uuid[],uuid) SECURITY INVOKER;
DROP FUNCTION public.staff_create_training_broadcast(uuid,date,text,jsonb,uuid[]);
CREATE FUNCTION public.staff_create_training_broadcast(_price_option_id uuid,_scheduled_date date,_scheduled_time_slot text,_address jsonb,_expert_ids uuid[],_actor uuid,_visible_cities uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _addr uuid; _lat numeric; _lng numeric; _city uuid; _row public.bookings; _staff uuid;
BEGIN
 SELECT id INTO _staff FROM public.staff_users WHERE auth_user_id=_actor AND status='active' AND role IN ('super_admin','ops_manager');
 IF _staff IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF cardinality(coalesce(_expert_ids,'{}'))=0 THEN RAISE EXCEPTION 'Select at least one training expert'; END IF;
 SELECT city_id INTO _city FROM public.experts WHERE id=_expert_ids[1];
 IF _city IS NULL OR NOT coalesce(_city=ANY(_visible_cities),false) THEN RAISE EXCEPTION 'City not permitted'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_city_access WHERE staff_user_id=_staff) AND NOT EXISTS(SELECT 1 FROM public.staff_city_access WHERE staff_user_id=_staff AND city_id=_city) THEN RAISE EXCEPTION 'City not permitted'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(_expert_ids) x(id) LEFT JOIN public.experts e ON e.id=x.id WHERE e.id IS NULL OR e.mode<>'TRAINING' OR e.status<>'active' OR e.city_id IS DISTINCT FROM _city) THEN RAISE EXCEPTION 'Select active training experts in one city'; END IF;
 _lat:=(_address->>'latitude')::numeric; _lng:=(_address->>'longitude')::numeric;
 IF _lat IS NULL OR _lng IS NULL OR coalesce(btrim(_address->>'full_address'),'')='' THEN RAISE EXCEPTION 'Enter a training address with map coordinates'; END IF;
 INSERT INTO public.addresses(user_id,label,full_address,area,city,latitude,longitude,city_id) VALUES(NULL,'Training',_address->>'full_address',_address->>'area',_address->>'city',_lat,_lng,_city) RETURNING id INTO _addr;
 PERFORM set_config('app.booking_bypass','on',true);
 INSERT INTO public.bookings(user_id,address_id,booking_lat,booking_lng,city_id,price_option_id,slot_type,scheduled_date,scheduled_time_slot,is_training,training_expert_ids,start_otp,end_otp)
 VALUES(NULL,_addr,_lat,_lng,_city,_price_option_id,CASE WHEN _scheduled_date IS NULL THEN 'now' ELSE 'scheduled' END,_scheduled_date,_scheduled_time_slot,true,_expert_ids,public.generate_otp4(),public.generate_otp4()) RETURNING * INTO _row;
 UPDATE public.bookings SET status='accepted' WHERE id=_row.id AND status='confirmed';
 PERFORM set_config('app.booking_bypass','off',true);
 INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state) VALUES(_actor,'training_booking_broadcast_created','bookings',_row.id,jsonb_build_object('expert_ids',_expert_ids,'price_option_id',_price_option_id));
 SELECT * INTO _row FROM public.bookings WHERE id=_row.id;
 RETURN to_jsonb(_row);
END $$;
REVOKE ALL ON FUNCTION public.staff_create_training_broadcast(uuid,date,text,jsonb,uuid[],uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_create_training_broadcast(uuid,date,text,jsonb,uuid[],uuid,uuid[]) TO service_role;
