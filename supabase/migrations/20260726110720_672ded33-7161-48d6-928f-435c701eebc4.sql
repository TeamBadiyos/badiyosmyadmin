
CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status = 'completed' THEN
    SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
      WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    RETURN COALESCE(_payout, 0);
  END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
    WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  _payout := COALESCE(_payout, 0);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 THEN
    -- created_by references staff_users(id); expert-initiated completion has
    -- no staff actor, so leave NULL rather than passing auth.uid() (which is
    -- the expert's auth user id and not present in staff_users).
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _expert_id;
  END IF;

  PERFORM public.notify_customer_push(
    _booking_id,
    'Service completed',
    'Your booking is complete! Please rate your experience.',
    'booking/' || _booking_id::text
  );

  RETURN _payout;
END $function$;

CREATE OR REPLACE FUNCTION public.staff_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _staff_id uuid;
  _b record;
  _now timestamptz := now();
  _payout numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id, role INTO _staff_id, _role FROM public.staff_users
    WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, status, end_otp, deleted_at, assigned_expert_id, service_duration_minutes
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking is not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_b.end_otp) = '' THEN RAISE EXCEPTION 'No end OTP set'; END IF;
  IF btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, _now), updated_at = _now
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _b.assigned_expert_id IS NOT NULL THEN
    UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;

    SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
      WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    _payout := COALESCE(_payout, 0);

    IF _payout > 0 THEN
      INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
      VALUES('expert', _b.assigned_expert_id, _payout, 'credit',
             'Booking payout (staff-relayed): ' || _booking_id::text, _staff_id);
      UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout
        WHERE id = _b.assigned_expert_id;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'staff_relayed_end_otp', 'bookings', _booking_id,
    jsonb_build_object('status', _b.status),
    jsonb_build_object('status', 'completed', 'completed_at', _now,
      'note', 'OTP relayed by expert via phone/WhatsApp; verified by staff (interim flow).'));

  PERFORM public.notify_customer_push(
    _booking_id,
    'Service completed',
    'Your booking is complete! Please rate your experience.',
    'booking/' || _booking_id::text
  );
END;
$function$;
