CREATE OR REPLACE FUNCTION public.staff_cancel_training_booking(_booking_id uuid, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _b public.bookings; _r jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id=_actor AND status='active' AND role IN ('super_admin','ops_manager')) THEN
    RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _b FROM public.bookings WHERE id=_booking_id;
  IF _b.id IS NULL OR NOT coalesce(_b.is_training,false) THEN RAISE EXCEPTION 'Only training orders can be cancelled here'; END IF;
  IF _b.status IN ('completed','cancelled','rejected','expired') THEN RAISE EXCEPTION 'This order is already closed'; END IF;
  _r := public.booking_cancel_core(_booking_id, 'staff', _actor, 'Training order cancelled', 'wallet', 'full');
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES(_actor,'training_booking_cancelled','bookings',_booking_id,jsonb_build_object('status',_b.status),jsonb_build_object('status','cancelled'));
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION public.staff_cancel_training_booking(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_cancel_training_booking(uuid,uuid) TO service_role;