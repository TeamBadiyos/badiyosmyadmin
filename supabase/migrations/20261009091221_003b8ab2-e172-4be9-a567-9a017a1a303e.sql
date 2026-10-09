CREATE OR REPLACE FUNCTION public.staff_transfer_completed_work(_booking_id uuid, _new_expert_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _role text; _b record; _ok boolean; _amt numeric := 0; _before jsonb; _after jsonb; _new_name text; _old_name text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=_uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'Reason is required'; END IF;
  SELECT * INTO _b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.status <> 'completed' THEN RAISE EXCEPTION 'Only completed bookings can be transferred'; END IF;
  IF COALESCE(_b.is_training,false) THEN RAISE EXCEPTION 'Training bookings cannot be transferred'; END IF;
  IF _b.assigned_expert_id IS NULL THEN RAISE EXCEPTION 'No expert on this booking'; END IF;
  IF _b.assigned_expert_id = _new_expert_id THEN RAISE EXCEPTION 'Choose a different expert'; END IF;
  SELECT (status='active'), name INTO _ok, _new_name FROM public.experts WHERE id=_new_expert_id;
  IF NOT COALESCE(_ok,false) THEN RAISE EXCEPTION 'Expert not active'; END IF;
  SELECT name INTO _old_name FROM public.experts WHERE id=_b.assigned_expert_id;
  IF EXISTS (SELECT 1 FROM public.payout_batch_items i JOIN public.payout_batches p ON p.id=i.batch_id
             WHERE i.owner_id=_b.assigned_expert_id AND NOT COALESCE(i.removed,false) AND p.status <> 'discarded'
               AND _booking_id::text = ANY(i.booking_ids::text[])) THEN
    RAISE EXCEPTION 'This booking is already in a payout batch. Remove it from the batch (or discard the batch) first.';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _amt FROM public.wallet_ledger
   WHERE owner_type='expert' AND owner_id=_b.assigned_expert_id AND reason='Booking payout: ' || _booking_id::text;
  _before := to_jsonb(_b);
  IF _amt > 0 THEN
    UPDATE public.wallet_ledger SET owner_id=_new_expert_id
     WHERE owner_type='expert' AND owner_id=_b.assigned_expert_id AND reason='Booking payout: ' || _booking_id::text;
    UPDATE public.experts SET wallet_balance=COALESCE(wallet_balance,0)-_amt WHERE id=_b.assigned_expert_id;
    UPDATE public.experts SET wallet_balance=COALESCE(wallet_balance,0)+_amt WHERE id=_new_expert_id;
  END IF;
  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET assigned_expert_id=_new_expert_id WHERE id=_booking_id;
  PERFORM set_config('app.booking_bypass','off',true);
  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id=_booking_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'completed_work_transfer', 'bookings', _booking_id,
    _before || jsonb_build_object('reason', btrim(_reason), 'amount', _amt, 'from_expert', _old_name, 'to_expert', _new_name),
    _after || jsonb_build_object('reason', btrim(_reason), 'amount', _amt, 'from_expert', _old_name, 'to_expert', _new_name));
  RETURN jsonb_build_object('amount', _amt, 'minutes', COALESCE(_b.service_duration_minutes,0), 'from', _old_name, 'to', _new_name);
END $$;
REVOKE ALL ON FUNCTION public.staff_transfer_completed_work(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_transfer_completed_work(uuid, uuid, text) TO authenticated;