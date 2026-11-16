CREATE TABLE public.courier_staff_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.courier_orders(id), stop_id uuid REFERENCES public.courier_order_stops(id), city_id uuid REFERENCES public.cities(id), action text NOT NULL, reason text NOT NULL, note text, photo_path text, staff_id uuid NOT NULL, staff_name text NOT NULL, before_state jsonb NOT NULL, after_state jsonb NOT NULL, undone_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.courier_staff_overrides TO authenticated;
GRANT ALL ON public.courier_staff_overrides TO service_role;
GRANT SELECT ON public.courier_staff_overrides TO cc_reader;
ALTER TABLE public.courier_staff_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON public.courier_staff_overrides FOR SELECT TO authenticated USING (public.courier_is_ops_staff());
CREATE POLICY cc_city_scope ON public.courier_staff_overrides AS RESTRICTIVE FOR ALL TO authenticated USING (city_id = ANY(public.staff_allowed_city_ids())) WITH CHECK (city_id = ANY(public.staff_allowed_city_ids()));
CREATE POLICY cc_reader_all ON public.courier_staff_overrides FOR SELECT TO cc_reader USING (true);
CREATE TRIGGER courier_overrides_updated BEFORE UPDATE ON public.courier_staff_overrides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX courier_overrides_order ON public.courier_staff_overrides(order_id,created_at DESC);

-- Internal staff variants reuse the normal rider arrival/failure implementation.
DO $patch$
DECLARE _d text;
BEGIN
 _d:=pg_get_functiondef('public.courier_rider_arrive_stop(uuid,numeric,numeric,numeric,timestamp with time zone)'::regprocedure);
 _d:=replace(_d,'public.courier_rider_arrive_stop(', 'public.courier_staff_arrive_internal(');
 _d:=replace(_d,'_eid := public.get_expert_id_for_auth(auth.uid());','if not public.courier_is_ops_staff() then raise exception ''Forbidden'' using errcode=''42501''; end if; select assigned_expert_id into _eid from public.courier_orders where id=(select order_id from public.courier_order_stops where id=_stop_id);');
 _d:=replace(_d,'''app.courier_actor_type'',''rider''','''app.courier_actor_type'',''staff''');
 _d:=replace(_d,'''app.courier_actor_id'', _eid::text','''app.courier_actor_id'', auth.uid()::text');
 EXECUTE _d;
 _d:=pg_get_functiondef('public.courier_rider_fail_stop(uuid,text,text,jsonb)'::regprocedure);
 _d:=replace(_d,'public.courier_rider_fail_stop(', 'public.courier_staff_fail_internal(');
 _d:=replace(_d,'_eid := public.get_expert_id_for_auth(auth.uid());','if not public.courier_is_ops_staff() then raise exception ''Forbidden'' using errcode=''42501''; end if; select assigned_expert_id into _eid from public.courier_orders where id=(select order_id from public.courier_order_stops where id=_stop_id);');
 _d:=replace(_d,'if _st.arrived_at + make_interval(mins => _wait) > now() then','if false then');
 _d:=replace(_d,'''app.courier_actor_type'',''rider''','''app.courier_actor_type'',''staff''');
 _d:=replace(_d,'''app.courier_actor_id'', _eid::text','''app.courier_actor_id'', auth.uid()::text');
 EXECUTE _d;
 _d:=pg_get_functiondef('public.staff_courier_reassign_rider(uuid,uuid)'::regprocedure);
 _d:=replace(_d,'public.staff_courier_reassign_rider(', 'public.courier_staff_assign_internal(');
 _d:=replace(_d,'if _o.status not in (''REQUESTED'',''SEARCHING'',''DRIVER_ASSIGNED'',''ARRIVED_PICKUP'') then','if _o.status not in (''REQUESTED'',''SEARCHING'',''DRIVER_ASSIGNED'',''ARRIVED_PICKUP'',''PICKED_UP'',''IN_TRANSIT'') then');
 -- Do not free a rider who still owns a different active job.
 _d:=replace(_d,'where id=_o.assigned_expert_id;', 'where id=_o.assigned_expert_id and not exists (select 1 from public.courier_orders x where x.assigned_expert_id=_o.assigned_expert_id and x.id<>_o.id and x.status not in (''COMPLETED'',''DELIVERED'',''CANCELLED'',''FAILED_DELIVERY'')) and not exists (select 1 from public.bookings b where b.expert_id=_o.assigned_expert_id and b.status in (''expert_assigned'',''on_the_way'',''arrived'',''in_progress''));');
 EXECUTE _d;
END $patch$;
REVOKE ALL ON FUNCTION public.courier_staff_arrive_internal(uuid,numeric,numeric,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.courier_staff_fail_internal(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.courier_staff_assign_internal(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.courier_override_snapshot(_order uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('order',to_jsonb(o),'stops',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM courier_order_stops s WHERE s.order_id=o.id),'parcels',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM courier_order_parcels p WHERE p.order_id=o.id),'secrets',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.stop_id),'[]') FROM courier_stop_secrets s JOIN courier_order_stops st ON st.id=s.stop_id WHERE st.order_id=o.id),'charges',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM courier_order_charges c WHERE c.order_id=o.id)) FROM courier_orders o WHERE o.id=_order
$$;
REVOKE ALL ON FUNCTION public.courier_override_snapshot(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.staff_courier_override(_order_id uuid,_action text,_reason text,_note text DEFAULT NULL,_stop_id uuid DEFAULT NULL,_expert_id uuid DEFAULT NULL,_next_status text DEFAULT NULL,_photo_path text DEFAULT NULL,_return_distances jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE _o courier_orders%rowtype; _st courier_order_stops%rowtype; _before jsonb; _after jsonb; _name text; _id uuid; _r record; _last courier_staff_overrides%rowtype; _reason_full text; _target text;
BEGIN
 IF NOT public.courier_is_ops_staff() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
 SELECT * INTO _o FROM courier_orders WHERE id=_order_id FOR UPDATE;
 IF _o.id IS NULL OR NOT coalesce(_o.city_id=ANY(public.staff_allowed_city_ids()),false) THEN RAISE EXCEPTION 'Order not available in your city scope' USING errcode='42501'; END IF;
 IF _reason NOT IN ('Rider phone dead','OTP not received','Customer unreachable','App issue','Other') OR _reason IS NULL THEN RAISE EXCEPTION 'Select an override reason'; END IF;
 IF _reason='Other' AND length(coalesce(btrim(_note),''))<10 THEN RAISE EXCEPTION 'Other requires a note of at least 10 characters'; END IF;
 IF length(coalesce(_note,''))>500 THEN RAISE EXCEPTION 'Note is too long'; END IF;
 IF _photo_path IS NOT NULL AND (_photo_path NOT LIKE ('staff-overrides/'||_order_id::text||'/%') OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='courier-proofs' AND name=_photo_path)) THEN RAISE EXCEPTION 'Invalid override photo'; END IF;
 SELECT name INTO _name FROM staff_users WHERE auth_user_id=auth.uid();
 _reason_full:=_reason||CASE WHEN nullif(btrim(_note),'') IS NULL THEN '' ELSE ': '||btrim(_note) END;
 _before:=public.courier_override_snapshot(_order_id);
 PERFORM set_config('app.courier_actor_type','staff',true); PERFORM set_config('app.courier_actor_id',auth.uid()::text,true);
 IF _stop_id IS NOT NULL THEN SELECT * INTO _st FROM courier_order_stops WHERE id=_stop_id AND order_id=_order_id FOR UPDATE; IF _st.id IS NULL THEN RAISE EXCEPTION 'Stop not found'; END IF; END IF;
 IF _action='undo' THEN
  SELECT * INTO _last FROM courier_staff_overrides WHERE order_id=_order_id AND stop_id=_stop_id AND action IN ('arrive','complete','fail') AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF _last.id IS NULL OR clock_timestamp()>_last.created_at+interval '30 minutes' THEN RAISE EXCEPTION 'Undo is only available within 30 minutes'; END IF;
  IF _o.earnings_credited_at IS NOT NULL OR _o.status IN ('COMPLETED','DELIVERED','CANCELLED','FAILED_DELIVERY') THEN RAISE EXCEPTION 'Cannot undo after completion or payout'; END IF;
  IF _before IS DISTINCT FROM _last.after_state OR _before->'charges' IS DISTINCT FROM _last.before_state->'charges' OR jsonb_array_length(_before->'stops')<>jsonb_array_length(_last.before_state->'stops') OR _before->'order'->>'status' IS DISTINCT FROM _last.before_state->'order'->>'status' THEN RAISE EXCEPTION 'Cannot undo after later activity, order transition, or billing/return changes'; END IF;
  UPDATE courier_order_stops s SET status=x.status,arrived_at=x.arrived_at,completed_at=x.completed_at,failed_at=x.failed_at,fail_reason_code=x.fail_reason_code,completed_via=x.completed_via FROM jsonb_populate_recordset(NULL::courier_order_stops,_last.before_state->'stops') x WHERE s.id=x.id;
  UPDATE courier_order_parcels p SET status=x.status,return_stop_id=x.return_stop_id FROM jsonb_populate_recordset(NULL::courier_order_parcels,_last.before_state->'parcels') x WHERE p.id=x.id;
  UPDATE courier_stop_secrets s SET verified_at=x.verified_at FROM jsonb_populate_recordset(NULL::courier_stop_secrets,_last.before_state->'secrets') x WHERE s.stop_id=x.stop_id;
  UPDATE courier_staff_overrides SET undone_at=now() WHERE id=_last.id;
 ELSIF _o.status IN ('COMPLETED','DELIVERED','CANCELLED','FAILED_DELIVERY') THEN RAISE EXCEPTION 'Order is already closed';
 ELSIF _action='assign' THEN
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Select a rider'; END IF; PERFORM public.courier_staff_assign_internal(_order_id,_expert_id);
 ELSIF _action='unassign' THEN
  IF _o.status NOT IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP') THEN RAISE EXCEPTION 'Unassign is only available before pickup'; END IF;
  UPDATE courier_orders SET status='SEARCHING',assigned_expert_id=NULL,assigned_at=NULL,arrived_pickup_at=NULL WHERE id=_order_id;
  UPDATE courier_order_stops SET status='pending',arrived_at=NULL WHERE order_id=_order_id AND status='arrived';
  UPDATE experts SET is_busy=false WHERE id=_o.assigned_expert_id AND NOT EXISTS(SELECT 1 FROM courier_orders x WHERE x.assigned_expert_id=_o.assigned_expert_id AND x.id<>_order_id AND x.status NOT IN ('COMPLETED','DELIVERED','CANCELLED','FAILED_DELIVERY')) AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.expert_id=_o.assigned_expert_id AND b.status IN ('expert_assigned','on_the_way','arrived','in_progress'));
  PERFORM notify_expert_push(_o.assigned_expert_id,'Courier assignment removed','Staff removed this assignment.','home');
 ELSIF _action IN ('arrive','complete','fail','otp') THEN
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Select a stop'; END IF;
  IF _o.assigned_expert_id IS NULL THEN RAISE EXCEPTION 'Assign a rider first'; END IF;
  IF _st.status NOT IN ('pending','arrived') THEN RAISE EXCEPTION 'Stop is already closed'; END IF;
  IF EXISTS(SELECT 1 FROM courier_order_stops WHERE order_id=_order_id AND sequence<_st.sequence AND status NOT IN ('completed','failed','cancelled')) THEN RAISE EXCEPTION 'Complete the earlier stop first'; END IF;
  IF _action='otp' THEN
   IF public.courier_is_gifting_order(_order_id) THEN RAISE EXCEPTION 'Gifting routes do not use OTP'; END IF;
   PERFORM public.courier_issue_stop_otp(_stop_id);
  ELSE
   IF _st.status='pending' THEN PERFORM public.courier_staff_arrive_internal(_stop_id,NULL,NULL,NULL,NULL); END IF;
   IF _action='complete' THEN PERFORM public.staff_courier_verify_stop(_stop_id,_reason_full);
   ELSIF _action='fail' THEN PERFORM public.courier_staff_fail_internal(_stop_id,'OTHER',_reason_full,_return_distances); END IF;
  END IF;
 ELSIF _action='complete_all' THEN
  IF _o.assigned_expert_id IS NULL THEN RAISE EXCEPTION 'Assign a rider first'; END IF;
  IF EXISTS(SELECT 1 FROM courier_order_stops WHERE order_id=_order_id AND status='failed') THEN RAISE EXCEPTION 'Resolve failed stops through the existing return flow'; END IF;
  FOR _r IN SELECT id,status FROM courier_order_stops WHERE order_id=_order_id AND status IN ('pending','arrived') ORDER BY sequence LOOP
   IF _r.status='pending' THEN PERFORM public.courier_staff_arrive_internal(_r.id,NULL,NULL,NULL,NULL); END IF;
   PERFORM public.staff_courier_verify_stop(_r.id,_reason_full);
  END LOOP;
 ELSIF _action='status' THEN
  _target:=CASE _o.status WHEN 'DRIVER_ASSIGNED' THEN 'ARRIVED_PICKUP' WHEN 'ARRIVED_PICKUP' THEN 'PICKED_UP' WHEN 'PICKED_UP' THEN 'IN_TRANSIT' WHEN 'IN_TRANSIT' THEN 'DELIVERED' ELSE NULL END;
  IF _next_status IS DISTINCT FROM _target OR _target IS NULL THEN RAISE EXCEPTION 'Select a valid next state; use Assign, Unassign, or existing Cancel for other transitions'; END IF;
  IF _target='ARRIVED_PICKUP' THEN SELECT id INTO _id FROM courier_order_stops WHERE order_id=_order_id AND stop_type='pickup' AND status='pending' ORDER BY sequence LIMIT 1; PERFORM public.courier_staff_arrive_internal(_id,NULL,NULL,NULL,NULL);
  ELSIF _target='PICKED_UP' THEN SELECT id INTO _id FROM courier_order_stops WHERE order_id=_order_id AND stop_type='pickup' AND status='arrived' ORDER BY sequence LIMIT 1; IF _id IS NULL THEN RAISE EXCEPTION 'Mark pickup arrived first'; END IF; PERFORM public.staff_courier_verify_stop(_id,_reason_full);
  ELSIF _target='IN_TRANSIT' THEN PERFORM public.courier_recompute_order_progress(_order_id);
  ELSE
   IF EXISTS(SELECT 1 FROM courier_order_stops WHERE order_id=_order_id AND status NOT IN ('completed','failed','cancelled')) THEN RAISE EXCEPTION 'Complete remaining stops first'; END IF; PERFORM public.courier_recompute_order_progress(_order_id);
  END IF;
 ELSE RAISE EXCEPTION 'Invalid override action'; END IF;
 PERFORM set_config('app.courier_actor_type','staff',true); PERFORM set_config('app.courier_actor_id',auth.uid()::text,true);
 IF (SELECT status FROM courier_orders WHERE id=_order_id)='DELIVERED' THEN PERFORM public.courier_settle_order(_order_id); END IF;
 UPDATE courier_offers SET status='cancelled',responded_at=now() WHERE order_id=_order_id AND status='pending';
 _after:=public.courier_override_snapshot(_order_id);
 INSERT INTO courier_staff_overrides(order_id,stop_id,city_id,action,reason,note,photo_path,staff_id,staff_name,before_state,after_state) VALUES(_order_id,_stop_id,_o.city_id,_action,_reason,_note,_photo_path,auth.uid(),coalesce(_name,'Staff'),_before,_after) RETURNING id INTO _id;
 INSERT INTO courier_order_events(order_id,from_status,to_status,actor_type,actor_id,meta) VALUES(_order_id,_o.status,_after->'order'->>'status','staff',auth.uid(),jsonb_build_object('event','staff_override','override_id',_id,'stop_id',_stop_id,'action',_action,'staff_name',_name,'reason',_reason_full,'photo_path',_photo_path));
 INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state) VALUES(auth.uid(),'courier_staff_override','courier_orders',_order_id,jsonb_build_object('status',_o.status,'stop_id',_stop_id),jsonb_build_object('status',_after->'order'->>'status','override_id',_id,'reason',_reason_full));
 IF _o.assigned_expert_id IS NOT NULL THEN PERFORM notify_expert_push(_o.assigned_expert_id,'Courier updated by staff',_reason_full,'home'); END IF;
 IF _action IN ('undo','unassign','status') THEN PERFORM notify_customer_user_push(_o.customer_id,'Courier order updated','Staff updated your delivery. Check the latest status in the app.','home'); END IF;
 RETURN jsonb_build_object('ok',true,'override_id',_id,'order_status',_after->'order'->>'status');
END $fn$;
REVOKE ALL ON FUNCTION public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_courier_override(uuid,text,text,text,uuid,uuid,text,text,jsonb) TO authenticated,service_role;