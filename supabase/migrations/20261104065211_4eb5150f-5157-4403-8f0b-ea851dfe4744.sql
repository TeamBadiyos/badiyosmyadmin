CREATE OR REPLACE FUNCTION public.staff_reopen_started_booking(_booking_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _role text; _before jsonb; _after jsonb; _status text; _expert uuid; _n int;
BEGIN PERFORM public.require_staff();
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=_uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason is required'; END IF;
  SELECT to_jsonb(b), status, assigned_expert_id INTO _before,_status,_expert FROM public.bookings b WHERE id=_booking_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _status NOT IN ('expert_assigned','on_the_way','arrived','in_progress') THEN
    RAISE EXCEPTION 'Only assigned or started bookings can be moved back to scheduled'; END IF;
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET status='accepted', assigned_expert_id=NULL, started_at=NULL, service_end_at=NULL,
    on_the_way_at=NULL, arrived_at=NULL, expert_assigned_at=NULL, onway_alert_sent=false
   WHERE id=_booking_id AND status=_status;
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.booking_bypass','off',true);
  IF _n=0 THEN RAISE EXCEPTION 'Booking state changed, please refresh and try again'; END IF;
  IF _expert IS NOT NULL THEN
    UPDATE public.experts SET is_busy=false WHERE id=_expert
      AND public.expert_active_booking_count(_expert, _booking_id) = 0;
    PERFORM public.notify_expert_push(_expert,'Booking removed','Command Center has taken this booking back. No payment for this job.','home');
  END IF;
  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id=_booking_id;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (_uid,'staff_reopen_started_booking','bookings',_booking_id,_before||jsonb_build_object('reason',_reason),_after);
END $$;
REVOKE ALL ON FUNCTION public.staff_reopen_started_booking(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reopen_started_booking(uuid,text) TO authenticated, service_role;