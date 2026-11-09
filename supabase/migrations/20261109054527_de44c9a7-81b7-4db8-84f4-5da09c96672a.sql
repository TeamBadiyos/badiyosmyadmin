CREATE OR REPLACE FUNCTION public.courier_is_gifting_order(_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
 SELECT EXISTS(SELECT 1 FROM public.gift_trips t WHERE t.courier_order_id=_order_id)
 OR EXISTS(SELECT 1 FROM public.gift_drops d JOIN public.business_orders b ON b.id=d.business_order_id
 JOIN public.business_batches bt ON bt.id=b.batch_id WHERE bt.courier_order_id=_order_id)
$$;
REVOKE ALL ON FUNCTION public.courier_is_gifting_order(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.courier_is_gifting_order(uuid) TO authenticated,service_role,cc_reader;

ALTER TABLE public.courier_order_stops DROP CONSTRAINT courier_order_stops_completed_via_check;
ALTER TABLE public.courier_order_stops ADD CONSTRAINT courier_order_stops_completed_via_check CHECK (completed_via IS NULL OR completed_via IN ('otp','photo','manual'));

CREATE OR REPLACE FUNCTION public.courier_rider_complete_gifting_stop(_stop_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE _eid uuid; _o public.courier_orders; _s public.courier_order_stops; _h jsonb;
BEGIN
 _eid:=public.get_expert_id_for_auth(auth.uid());
 IF _eid IS NULL THEN RAISE EXCEPTION 'Not a rider' USING errcode='42501'; END IF;
 SELECT * INTO _s FROM public.courier_order_stops WHERE id=_stop_id;
 IF _s.id IS NULL THEN RAISE EXCEPTION 'Stop not found'; END IF;
 SELECT * INTO _o FROM public.courier_orders WHERE id=_s.order_id FOR UPDATE;
 IF _o.assigned_expert_id IS DISTINCT FROM _eid OR NOT public.courier_is_gifting_order(_o.id) THEN RAISE EXCEPTION 'Not assigned to this gifting trip' USING errcode='42501'; END IF;
 SELECT * INTO _s FROM public.courier_order_stops WHERE id=_stop_id FOR UPDATE;
 IF _o.status NOT IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT') THEN RAISE EXCEPTION 'Trip is not active'; END IF;
 IF _s.status='completed' THEN RETURN jsonb_build_object('ok',true,'already_completed',true,'order_status',_o.status); END IF;
 IF _s.status NOT IN ('pending','arrived') THEN RAISE EXCEPTION 'Stop is not active'; END IF;
 IF EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=_o.id AND sequence<_s.sequence AND status NOT IN ('completed','failed','cancelled')) THEN RAISE EXCEPTION 'Complete the earlier stop first'; END IF;
 IF _s.stop_type IN ('drop','return') AND _o.status<>'IN_TRANSIT' THEN RAISE EXCEPTION 'Complete pickup first'; END IF;
 PERFORM set_config('app.courier_actor_type','rider',true);
 PERFORM set_config('app.courier_actor_id',_eid::text,true);
 IF _s.status='pending' THEN
  PERFORM public.courier_rider_arrive_stop(_stop_id);
  SELECT * INTO _o FROM public.courier_orders WHERE id=_o.id;
 END IF;
 PERFORM public.business_audit('gifting_stop_marked_complete','courier_order_stops',_s.id,to_jsonb(_s),jsonb_build_object('completed_via','manual','order_id',_o.id,'stop_type',_s.stop_type),'rider');
 IF _s.stop_type='drop' THEN RETURN public.courier_complete_drop_internal(_o.id,_s.id,_eid,'manual',NULL); END IF;
 UPDATE public.courier_order_stops SET status='completed',completed_at=now(),completed_via='manual',updated_at=now() WHERE id=_s.id;
 INSERT INTO public.courier_order_events(order_id,from_status,to_status,actor_type,actor_id,meta) VALUES(_o.id,_o.status,_o.status,'rider',_eid,jsonb_build_object('event','gifting_stop_marked_complete','stop_id',_s.id,'stop_type',_s.stop_type,'completed_via','manual'));
 IF _s.stop_type='pickup' THEN
  UPDATE public.courier_order_parcels SET status='picked',updated_at=now() WHERE pickup_stop_id=_s.id AND status='pending';
  UPDATE public.courier_orders SET status='PICKED_UP',picked_up_at=now() WHERE id=_o.id AND status='ARRIVED_PICKUP';
 ELSE
  UPDATE public.courier_order_parcels SET status='returned',updated_at=now() WHERE return_stop_id=_s.id AND status='returning';
 END IF;
 _h:=public.courier_recompute_order_progress(_o.id);
 RETURN jsonb_build_object('ok',true,'issued_stop_ids','[]'::jsonb,'order_status',_h->>'order_status');
END $$;
REVOKE ALL ON FUNCTION public.courier_rider_complete_gifting_stop(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.courier_rider_complete_gifting_stop(uuid) TO authenticated,service_role;

-- Patch only verified anchors in deployed functions; retain all ordinary-delivery logic and ACLs.
DO $patch$
DECLARE _def text; _before text; _sig text;
BEGIN
 _sig:='public.business_create_trip_packets(uuid,uuid)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'  select * into _b from public.business_batches where id=_batch_id;','  if public.courier_is_gifting_order(_cid) then return 0; end if;'||chr(10)||'  select * into _b from public.business_batches where id=_batch_id;');
 IF _def=_before THEN RAISE EXCEPTION 'Missing packet creation anchor'; END IF; EXECUTE _def;

 _sig:='public.business_stop_proof_mode(uuid)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'select bp.drop_proof_mode','select case when public.courier_is_gifting_order(o.id) then ''none'' else bp.drop_proof_mode end');
 IF _def=_before THEN RAISE EXCEPTION 'Missing proof mode anchor'; END IF; EXECUTE _def;

 _sig:='public.courier_issue_stop_otp(uuid)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'  _p := public.courier_stop_purpose(_st.stop_type);','  if public.courier_is_gifting_order(_st.order_id) then return null; end if;'||chr(10)||'  _p := public.courier_stop_purpose(_st.stop_type);');
 IF _def=_before THEN RAISE EXCEPTION 'Missing OTP issue anchor'; END IF; EXECUTE _def;

 _sig:='public.courier_rider_arrive_stop(uuid,numeric,numeric,numeric,timestamp with time zone)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'  if _st.stop_type = ''pickup'' then'||chr(10)||'    perform public.courier_issue_stop_otp(_stop_id);','  if public.courier_is_gifting_order(_o.id) then return jsonb_build_object(''ok'',true,''issued_stop_ids'',''[]''::jsonb,''requires_otp'',false); end if;'||chr(10)||'  if _st.stop_type = ''pickup'' then'||chr(10)||'    perform public.courier_issue_stop_otp(_stop_id);');
 IF _def=_before THEN RAISE EXCEPTION 'Missing arrival anchor'; END IF; EXECUTE _def;

 _sig:='public.courier_recompute_order_progress(uuid)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'        perform public.courier_issue_stop_otp(_d.id);'||chr(10)||'        _issued := array_append(_issued, _d.id);','        if not public.courier_is_gifting_order(_order_id) then'||chr(10)||'          perform public.courier_issue_stop_otp(_d.id);'||chr(10)||'          _issued := array_append(_issued, _d.id);'||chr(10)||'        end if;');
 _def:=replace(_def,'''event'',''drop_otps_issued''','''event'',case when public.courier_is_gifting_order(_order_id) then ''gifting_route_started'' else ''drop_otps_issued'' end');
 IF _def=_before THEN RAISE EXCEPTION 'Missing progress anchor'; END IF; EXECUTE _def;

 _sig:='public.courier_complete_drop_internal(uuid,uuid,uuid,text,text)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'  update public.courier_stop_secrets set verified_at=now(), updated_at=now() where stop_id=_stop_id;','  if _via <> ''manual'' then update public.courier_stop_secrets set verified_at=now(), updated_at=now() where stop_id=_stop_id; end if;');
 _def:=replace(_def,'case when _via=''photo'' then ''stop_photo_verified'' else ''stop_otp_verified'' end','case when _via=''manual'' then ''gifting_stop_marked_complete'' when _via=''photo'' then ''stop_photo_verified'' else ''stop_otp_verified'' end');
 IF _def=_before THEN RAISE EXCEPTION 'Missing completion anchor'; END IF; EXECUTE _def;

 FOREACH _sig IN ARRAY ARRAY['public.courier_verify_stop_otp(uuid,text,text)','public.courier_complete_drop_with_proof(uuid,text[],numeric,numeric,numeric,timestamp with time zone)'] LOOP
  _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
  _def:=replace(_def,'  if _o.assigned_expert_id is distinct from _eid then raise exception ''Forbidden'' using errcode=''42501''; end if;','  if _o.assigned_expert_id is distinct from _eid then raise exception ''Forbidden'' using errcode=''42501''; end if;'||chr(10)||'  if public.courier_is_gifting_order(_o.id) then return public.courier_rider_complete_gifting_stop(_stop_id); end if;');
  IF _def=_before THEN RAISE EXCEPTION 'Missing assigned-rider anchor in %',_sig; END IF; EXECUTE _def;
 END LOOP;

 _sig:='public.courier_rider_fail_photo(uuid,text[],numeric,numeric)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'  if coalesce(array_length(_paths,1),0) < 1','  if public.courier_is_gifting_order(_o.id) then return jsonb_build_object(''ok'',true,''proof_required'',false); end if;'||chr(10)||'  if coalesce(array_length(_paths,1),0) < 1');
 IF _def=_before THEN RAISE EXCEPTION 'Missing failure proof anchor'; END IF; EXECUTE _def;

 _sig:='public.courier_trip_packets(uuid)'; _def:=pg_get_functiondef(_sig::regprocedure); _before:=_def;
 _def:=replace(_def,'  select bp.drop_proof_mode into _mode','  if public.courier_is_gifting_order(_o.id) then'||chr(10)||'    return jsonb_build_object(''order_id'',_o.id,''trip_no'',(select trip_no from public.business_batches where courier_order_id=_o.id limit 1),''is_gifting'',true,''delivery_mode'',''route_only'',''requires_scan'',false,''requires_otp'',false,''requires_proof'',false,''requires_geofence'',false,''drop_proof_mode'',''none'',''packets'',''[]''::jsonb,''removed_packets'',''[]''::jsonb,''drop_stops'',coalesce((select jsonb_agg(jsonb_build_object(''stop_id'',s.id,''sequence'',s.sequence,''status'',s.status,''drop_proof_mode'',''none'',''completed_via'',s.completed_via,''proofs'',''[]''::jsonb) order by s.sequence) from public.courier_order_stops s where s.order_id=_o.id and s.stop_type=''drop''),''[]''::jsonb));'||chr(10)||'  end if;'||chr(10)||'  select bp.drop_proof_mode into _mode');
 IF _def=_before THEN RAISE EXCEPTION 'Missing rider display anchor'; END IF; EXECUTE _def;
END $patch$;