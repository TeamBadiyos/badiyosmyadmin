CREATE OR REPLACE FUNCTION public.staff_reschedule_booking(_booking_id uuid, _date date, _slot text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _role text; b record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _date IS NULL OR _slot IS NULL OR btrim(_slot) = '' THEN RAISE EXCEPTION 'Date and slot are required'; END IF;
  IF _date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION 'Date cannot be in the past'; END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND OR b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF b.status NOT IN ('confirmed','accepted','expert_assigned','on_the_way','arrived') OR b.started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Booking cannot be rescheduled in its current state';
  END IF;

  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET
    scheduled_date = _date,
    scheduled_time_slot = btrim(_slot),
    slot_type = 'scheduled',
    status = 'confirmed',
    assigned_expert_id = NULL,
    expert_assigned_at = NULL,
    on_the_way_at = NULL,
    arrived_at = NULL,
    updated_at = now()
  WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off',true);

  IF b.assigned_expert_id IS NOT NULL THEN
    UPDATE public.experts SET is_busy = false WHERE id = b.assigned_expert_id;
    BEGIN
      PERFORM public.notify_expert_push(b.assigned_expert_id, 'Booking rescheduled', 'A booking assigned to you was rescheduled and removed from your queue.', jsonb_build_object('booking_id', _booking_id));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  BEGIN
    PERFORM public.notify_customer_push(b.user_id, 'Booking rescheduled', 'Your booking is now on ' || to_char(_date,'DD Mon') || ', ' || btrim(_slot), jsonb_build_object('booking_id', _booking_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reschedule_booking', 'bookings', _booking_id,
    jsonb_build_object('date', b.scheduled_date, 'slot', b.scheduled_time_slot, 'status', b.status, 'expert', b.assigned_expert_id),
    jsonb_build_object('date', _date, 'slot', btrim(_slot), 'status', 'confirmed', 'reason', _reason));
END $$;
REVOKE ALL ON FUNCTION public.staff_reschedule_booking(uuid,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_reschedule_booking(uuid,date,text,text) TO authenticated;