CREATE TABLE public.booking_expert_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  previous_expert_id uuid NOT NULL,
  new_expert_id uuid NOT NULL,
  minutes_worked int NOT NULL DEFAULT 0,
  total_payout numeric NOT NULL DEFAULT 0,
  previous_expert_payout numeric NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.booking_expert_handovers TO authenticated;
GRANT ALL ON public.booking_expert_handovers TO service_role;
ALTER TABLE public.booking_expert_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read handovers" ON public.booking_expert_handovers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active'));
CREATE INDEX ON public.booking_expert_handovers(booking_id);

CREATE OR REPLACE FUNCTION public.booking_total_expert_payout(_booking_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p numeric; _snap numeric;
BEGIN
  SELECT snapshot_expert_payout INTO _snap FROM public.bookings WHERE id=_booking_id;
  BEGIN SELECT r.expert_payout INTO _p FROM public.resolve_booking_payouts(_booking_id) r;
  EXCEPTION WHEN OTHERS THEN _p := NULL; END;
  RETURN COALESCE(NULLIF(COALESCE(_p,0),0), _snap, 0);
END $$;
REVOKE ALL ON FUNCTION public.booking_total_expert_payout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_total_expert_payout(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_handover_booking_expert(_booking_id uuid, _new_expert_id uuid, _previous_payout numeric, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _role text; _b record; _ok boolean; _busy boolean; _new_name text; _old_name text;
  _total numeric; _already numeric; _remaining numeric; _mins int; _before jsonb; _after jsonb; _hid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id=_uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'Reason is required'; END IF;
  IF _previous_payout IS NULL OR _previous_payout < 0 THEN RAISE EXCEPTION 'Invalid payout amount'; END IF;

  SELECT * INTO _b FROM public.bookings WHERE id=_booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Handover is only possible while service is in progress'; END IF;
  IF COALESCE(_b.is_training,false) THEN RAISE EXCEPTION 'Training bookings cannot be handed over'; END IF;
  IF _b.assigned_expert_id IS NULL THEN RAISE EXCEPTION 'No expert assigned'; END IF;
  IF _b.assigned_expert_id = _new_expert_id THEN RAISE EXCEPTION 'Choose a different expert'; END IF;

  SELECT (status='active'), COALESCE(is_busy,false), name INTO _ok, _busy, _new_name FROM public.experts WHERE id=_new_expert_id FOR UPDATE;
  IF NOT COALESCE(_ok,false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;
  IF NOT public.booking_expert_mode_ok(_booking_id, _new_expert_id) THEN RAISE EXCEPTION 'MODE_MISMATCH'; END IF;
  SELECT name INTO _old_name FROM public.experts WHERE id=_b.assigned_expert_id;

  _total := public.booking_total_expert_payout(_booking_id);
  SELECT COALESCE(SUM(previous_expert_payout),0) INTO _already FROM public.booking_expert_handovers WHERE booking_id=_booking_id;
  _remaining := GREATEST(_total - _already, 0);
  IF _previous_payout > _remaining THEN RAISE EXCEPTION 'Amount exceeds remaining payout (Rs %)', _remaining; END IF;
  _mins := GREATEST(0, floor(extract(epoch FROM (now() - COALESCE(_b.started_at, now())))/60))::int;

  _before := to_jsonb(_b);
  INSERT INTO public.booking_expert_handovers(booking_id, previous_expert_id, new_expert_id, minutes_worked, total_payout, previous_expert_payout, reason, created_by)
  VALUES(_booking_id, _b.assigned_expert_id, _new_expert_id, _mins, _total, _previous_payout, btrim(_reason), _uid) RETURNING id INTO _hid;

  IF _previous_payout > 0 THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _b.assigned_expert_id, _previous_payout, 'credit', 'Booking handover payout: ' || _booking_id::text || ' #' || _hid::text, _uid);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _previous_payout WHERE id=_b.assigned_expert_id;
  END IF;
  UPDATE public.experts SET is_busy=false WHERE id=_b.assigned_expert_id;

  PERFORM set_config('app.booking_bypass','on',true);
  UPDATE public.bookings SET assigned_expert_id=_new_expert_id, expert_assigned_at=now() WHERE id=_booking_id;
  PERFORM set_config('app.booking_bypass','off',true);
  UPDATE public.experts SET is_busy=true WHERE id=_new_expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id=_booking_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'expert_handover_by_staff', 'bookings', _booking_id,
    _before || jsonb_build_object('reason', _reason, 'previous_payout', _previous_payout, 'total_payout', _total), _after);

  BEGIN PERFORM public.notify_expert_push(_b.assigned_expert_id, 'Booking handed over',
    'This booking was handed over. Rs ' || _previous_payout::text || ' credited to your wallet.', 'home'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.notify_expert_push(_new_expert_id, 'Ongoing booking assigned',
    'You have been assigned an in-progress booking. Please continue the service.', 'booking/' || _booking_id::text); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM public.notify_customer_push(_booking_id, 'Expert changed',
    COALESCE(_new_name,'A new expert') || ' will complete your service.', 'booking/' || _booking_id::text); EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('previous_payout', _previous_payout, 'remaining_payout', _remaining - _previous_payout);
END $$;
REVOKE ALL ON FUNCTION public.staff_handover_booking_expert(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_handover_booking_expert(uuid, uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.credit_booking_completion(_booking_id uuid)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _b record; _payout numeric; _reason text; _handover numeric;
BEGIN
  SELECT id, assigned_expert_id, status, user_id, price, service_duration_minutes, snapshot_expert_payout
    INTO _b FROM public.bookings WHERE id = _booking_id;
  IF _b.id IS NULL OR _b.status <> 'completed' THEN RETURN 0; END IF;
  IF _b.assigned_expert_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id AND is_training) THEN
    UPDATE public.experts SET is_busy = false, training_orders_completed = COALESCE(training_orders_completed, 0) + 1
     WHERE id = _b.assigned_expert_id;
    BEGIN
      PERFORM public.notify_expert_alert(_b.assigned_expert_id, 'order_completed', 'Training job completed',
        'Well done! Your training job is complete.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text, 'is_training', true));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN 0;
  END IF;

  _payout := public.booking_total_expert_payout(_booking_id);
  SELECT COALESCE(SUM(previous_expert_payout),0) INTO _handover FROM public.booking_expert_handovers WHERE booking_id=_booking_id;
  _payout := GREATEST(_payout - _handover, 0);

  UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;
  _reason := 'Booking payout: ' || _booking_id::text;

  IF _payout > 0 AND NOT EXISTS (
      SELECT 1 FROM public.wallet_ledger WHERE owner_type = 'expert' AND reason = _reason) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _b.assigned_expert_id, _payout, 'credit', _reason, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _b.assigned_expert_id;
    BEGIN
      PERFORM public.evaluate_reward_triggers('partner', _b.assigned_expert_id, 'booking_completed', _booking_id::text,
        jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0), 'minutes', COALESCE(_b.service_duration_minutes,0)));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    IF _b.user_id IS NOT NULL THEN
      BEGIN
        PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed', _booking_id::text,
          jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    BEGIN
      PERFORM public.notify_expert_alert(_b.assigned_expert_id, 'order_completed', 'Job completed',
        'You completed the job. Rs ' || _payout::text || ' has been credited to your wallet.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text));
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN _payout;
END;
$function$;