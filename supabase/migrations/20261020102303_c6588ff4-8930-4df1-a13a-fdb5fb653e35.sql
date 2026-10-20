ALTER TABLE public.bookings ADD COLUMN training_expert_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.courier_orders ADD COLUMN training_expert_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.merchant_orders ADD COLUMN training_expert_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.staff_validate_training_experts(_ids uuid[], _city uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _visible uuid[];
BEGIN
 IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 _visible := public.cc_visible_cities();
 IF cardinality(coalesce(_ids,'{}'))=0 THEN RAISE EXCEPTION 'Select at least one training expert'; END IF;
 IF EXISTS (SELECT 1 FROM unnest(_ids) x(id) LEFT JOIN public.experts e ON e.id=x.id WHERE e.id IS NULL OR e.mode<>'TRAINING' OR e.status<>'active' OR (_city IS NOT NULL AND e.city_id IS DISTINCT FROM _city) OR (_visible IS NOT NULL AND NOT e.city_id=ANY(_visible))) THEN RAISE EXCEPTION 'Selected experts must be active, in Training mode and in your city'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.staff_validate_training_experts(uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_validate_training_experts(uuid[],uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_create_training_broadcast(_price_option_id uuid, _scheduled_date date, _scheduled_time_slot text, _address jsonb, _expert_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _addr uuid; _lat numeric; _lng numeric; _city uuid; _row public.bookings;
BEGIN
 PERFORM public.staff_validate_training_experts(_expert_ids);
 _lat := (_address->>'latitude')::numeric; _lng := (_address->>'longitude')::numeric;
 IF _lat IS NULL OR _lng IS NULL OR coalesce(btrim(_address->>'full_address'),'')='' THEN RAISE EXCEPTION 'Enter a training address with map coordinates'; END IF;
 SELECT city_id INTO _city FROM public.experts WHERE id=_expert_ids[1];
 PERFORM public.staff_validate_training_experts(_expert_ids,_city);
 INSERT INTO public.addresses(user_id,label,full_address,area,city,latitude,longitude,city_id) VALUES(NULL,'Training',_address->>'full_address',_address->>'area',_address->>'city',_lat,_lng,_city) RETURNING id INTO _addr;
 PERFORM set_config('app.booking_bypass','on',true);
 INSERT INTO public.bookings(user_id,address_id,booking_lat,booking_lng,city_id,price_option_id,slot_type,scheduled_date,scheduled_time_slot,is_training,training_expert_ids,start_otp,end_otp)
 VALUES(NULL,_addr,_lat,_lng,_city,_price_option_id,CASE WHEN _scheduled_date IS NULL THEN 'now' ELSE 'scheduled' END,_scheduled_date,_scheduled_time_slot,true,_expert_ids,public.generate_otp4(),public.generate_otp4()) RETURNING * INTO _row;
 UPDATE public.bookings SET status='accepted' WHERE id=_row.id AND status='confirmed';
 PERFORM set_config('app.booking_bypass','off',true);
 INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state) VALUES(auth.uid(),'training_booking_broadcast_created','bookings',_row.id,jsonb_build_object('expert_ids',_expert_ids,'price_option_id',_price_option_id));
 SELECT * INTO _row FROM public.bookings WHERE id=_row.id;
 RETURN to_jsonb(_row);
END $$;
REVOKE ALL ON FUNCTION public.staff_create_training_broadcast(uuid,date,text,jsonb,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_create_training_broadcast(uuid,date,text,jsonb,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.booking_expert_mode_ok(_booking_id uuid,_expert_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.bookings b JOIN public.experts e ON e.id=_expert_id WHERE b.id=_booking_id AND e.mode=CASE WHEN b.is_training THEN 'TRAINING' ELSE 'LIVE' END AND (NOT b.is_training OR (e.status='active' AND (cardinality(b.training_expert_ids)=0 OR e.id=ANY(b.training_expert_ids)))))
$$;
CREATE POLICY training_selected_booking_read ON public.bookings FOR SELECT TO authenticated USING(is_training AND assigned_expert_id IS NULL AND status='accepted' AND public.get_expert_id_for_auth(auth.uid())=ANY(training_expert_ids));
CREATE POLICY training_selected_booking_scope ON public.bookings AS RESTRICTIVE FOR SELECT TO authenticated USING(NOT is_training OR cardinality(training_expert_ids)=0 OR EXISTS(SELECT 1 FROM public.staff_users s WHERE s.auth_user_id=auth.uid() AND s.status='active') OR assigned_expert_id=public.get_expert_id_for_auth(auth.uid()) OR public.get_expert_id_for_auth(auth.uid())=ANY(training_expert_ids));

DO $patch$
DECLARE _def text;
BEGIN
 _def := pg_get_functiondef('public.broadcast_booking_to_experts(uuid,numeric)'::regprocedure);
 _def := replace(_def,'IF b.id IS NULL THEN RETURN 0; END IF;', 'IF b.id IS NULL THEN RETURN 0; END IF;
 IF b.is_training AND cardinality(b.training_expert_ids)>0 THEN
   IF b.status<>''accepted'' OR b.assigned_expert_id IS NOT NULL THEN RETURN 0; END IF;
   FOR r IN SELECT e.id FROM public.experts e WHERE e.id=ANY(b.training_expert_ids) AND e.mode=''TRAINING'' AND e.status=''active'' LOOP
     PERFORM public.notify_expert_broadcast(r.id,b.id,''Training order'',coalesce(b.service_label,''Training'') || '' — tap to accept.'');
     _count := _count+1;
   END LOOP;
   RETURN _count;
 END IF;');
 EXECUTE _def;
 _def := pg_get_functiondef('public.claim_booking_as_expert(uuid)'::regprocedure);
 _def := replace(_def,'v_row public.bookings;', 'v_training boolean; v_row public.bookings;');
 _def := replace(_def,'IF v_exp_lat IS NULL OR v_exp_lng IS NULL THEN', 'SELECT is_training AND cardinality(training_expert_ids)>0 INTO v_training FROM public.bookings WHERE id=p_booking_id;
 IF NOT coalesce(v_training,false) AND (v_exp_lat IS NULL OR v_exp_lng IS NULL) THEN');
 _def := replace(_def,'IF v_bk_lat IS NULL OR v_bk_lng IS NULL THEN','IF NOT coalesce(v_training,false) AND (v_bk_lat IS NULL OR v_bk_lng IS NULL) THEN');
 _def := replace(_def,'IF v_cat IS NOT NULL AND NOT EXISTS (','IF NOT coalesce(v_training,false) AND v_cat IS NOT NULL AND NOT EXISTS (');
 _def := replace(_def,'IF v_distance > v_radius THEN','IF NOT coalesce(v_training,false) AND v_distance > v_radius THEN');
 EXECUTE _def;
 _def := pg_get_functiondef('public.courier_dispatch_next(uuid)'::regprocedure);
 _def := replace(_def,'if _o.id is null or _o.status <> ''SEARCHING'' then return false; end if;', 'if _o.id is null or _o.status <> ''SEARCHING'' then return false; end if;
 if _o.is_training then
   for _r in select e.id as expert_id from public.experts e where e.id=ANY(_o.training_expert_ids) and e.mode=''TRAINING'' and e.status=''active'' and not exists(select 1 from public.courier_offers f where f.order_id=_o.id and f.expert_id=e.id and f.status in (''pending'',''rejected'',''expired'',''accepted'')) loop
     insert into public.courier_offers(order_id,expert_id,distance_km,expires_at) values(_o.id,_r.expert_id,0,now()+interval ''30 minutes'') returning * into _offer;
     perform public.notify_courier_offer_push(_offer.id,_r.expert_id);
     _sent:=_sent+1;
   end loop;
   return _sent>0;
 end if;');
 EXECUTE _def;
END $patch$;

CREATE OR REPLACE FUNCTION public.training_selected_assignment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.is_training AND NEW.assigned_expert_id IS NOT NULL AND NEW.assigned_expert_id IS DISTINCT FROM OLD.assigned_expert_id AND cardinality(NEW.training_expert_ids)>0 THEN
  PERFORM 1 FROM public.experts e WHERE e.id=NEW.assigned_expert_id AND e.mode='TRAINING' AND e.status='active' AND NOT coalesce(e.is_busy,false) AND e.id=ANY(NEW.training_expert_ids) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a selected available training expert can accept' USING errcode='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a1_training_selected_assignment_guard BEFORE UPDATE OF assigned_expert_id ON public.courier_orders FOR EACH ROW EXECUTE FUNCTION public.training_selected_assignment_guard();

CREATE OR REPLACE FUNCTION public.training_store_ready_broadcast()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _addr jsonb; _lat numeric; _lng numeric; _v uuid; _t uuid; _cid uuid; _actor uuid; _m record;
BEGIN
 IF NOT NEW.is_training OR NEW.status<>'ready' OR OLD.status=NEW.status OR NEW.courier_order_id IS NOT NULL OR cardinality(NEW.training_expert_ids)=0 THEN RETURN NEW; END IF;
 SELECT value::jsonb INTO _addr FROM public.ops_settings WHERE key='training_address';
 _lat:=coalesce((_addr->>'latitude')::numeric,18.4088); _lng:=coalesce((_addr->>'longitude')::numeric,76.5604);
 SELECT id INTO _v FROM public.courier_vehicle_types ORDER BY name LIMIT 1;
 SELECT id INTO _t FROM public.courier_types ORDER BY name LIMIT 1;
 SELECT actor_id INTO _actor FROM public.audit_logs WHERE target_id=NEW.id AND action='store_training_order_created' ORDER BY created_at DESC LIMIT 1;
 _actor:=coalesce(auth.uid(),_actor);
 SELECT store_name,city INTO _m FROM public.merchants WHERE id=NEW.merchant_id;
 INSERT INTO public.courier_orders(customer_id,city,city_id,vehicle_type_id,courier_type_id,pickup_lat,pickup_lng,pickup_address,pickup_contact_name,pickup_contact_phone,drop_lat,drop_lng,drop_address,drop_contact_name,drop_contact_phone,is_training,training_expert_ids,status,payment_status,merchant_order_id,source)
 VALUES(_actor,coalesce(_m.city,'Latur'),NEW.city_id,_v,_t,_lat,_lng,coalesce(_m.store_name,'Training store'),'Training Sender','9999999999',_lat+0.01,_lng+0.01,coalesce(NEW.delivery_address,'Training drop'),'Training Receiver','9999999998',true,NEW.training_expert_ids,'SEARCHING','pending',NEW.id,'store') RETURNING id INTO _cid;
 UPDATE public.merchant_orders SET courier_order_id=_cid WHERE id=NEW.id;
 PERFORM public.courier_dispatch_next(_cid);
 INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,after_state) VALUES(_actor,'store_training_delivery_broadcast','merchant_orders',NEW.id,jsonb_build_object('courier_order_id',_cid,'expert_ids',NEW.training_expert_ids));
 RETURN NEW;
END $$;
CREATE TRIGGER training_store_ready_broadcast AFTER UPDATE OF status ON public.merchant_orders FOR EACH ROW EXECUTE FUNCTION public.training_store_ready_broadcast();
REVOKE ALL ON FUNCTION public.training_selected_assignment_guard(), public.training_store_ready_broadcast() FROM PUBLIC,anon,authenticated;
