
-- 1. Add is_busy column
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS is_busy boolean NOT NULL DEFAULT false;

-- Backfill: any expert currently holding an active job is busy
UPDATE public.experts e
SET is_busy = true
WHERE EXISTS (
  SELECT 1 FROM public.bookings b
  WHERE b.assigned_expert_id = e.id
    AND b.status IN ('expert_assigned','in_progress')
    AND b.deleted_at IS NULL
);

-- 2. claim_booking_as_expert (expert-called, single arg) — sets is_busy on claim
CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(p_booking_id uuid)
 RETURNS public.bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expert_id uuid;
  v_exp_lat numeric;
  v_exp_lng numeric;
  v_is_busy boolean;
  v_bk_lat numeric;
  v_bk_lng numeric;
  v_radius numeric;
  v_distance numeric;
  v_current_status text;
  v_current_assigned uuid;
  v_row public.bookings;
BEGIN
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  IF v_expert_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT current_lat, current_lng, is_busy
    INTO v_exp_lat, v_exp_lng, v_is_busy
    FROM public.experts WHERE id = v_expert_id FOR UPDATE;

  IF v_is_busy THEN
    RAISE EXCEPTION 'You already have an active booking. Complete it before accepting a new one.';
  END IF;

  IF v_exp_lat IS NULL OR v_exp_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  SELECT booking_lat, booking_lng, status, assigned_expert_id
    INTO v_bk_lat, v_bk_lng, v_current_status, v_current_assigned
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_bk_lat IS NULL OR v_bk_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  v_distance := public.haversine_km(v_exp_lat, v_exp_lng, v_bk_lat, v_bk_lng);
  IF v_distance > v_radius THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  IF v_current_status <> 'accepted' OR v_current_assigned IS NOT NULL THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  PERFORM set_config('app.booking_bypass', 'true', true);
  UPDATE public.bookings
    SET assigned_expert_id = v_expert_id,
        status = 'expert_assigned',
        updated_at = now()
    WHERE id = p_booking_id
      AND status = 'accepted'
      AND assigned_expert_id IS NULL
    RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  -- Mark expert busy atomically with the assignment
  UPDATE public.experts SET is_busy = true WHERE id = v_expert_id;

  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'expert', 'claim_booking', 'booking', p_booking_id,
          jsonb_build_object('expert_id', v_expert_id, 'distance_km', v_distance));

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_booking_as_expert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_booking_as_expert(uuid) TO authenticated;

-- 3. Drop legacy 2-arg claim_booking_as_expert (duplicated by staff_assign_expert)
DROP FUNCTION IF EXISTS public.claim_booking_as_expert(uuid, uuid);

-- 4. staff_assign_expert — also sets busy
CREATE OR REPLACE FUNCTION public.staff_assign_expert(_booking_id uuid, _expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _expert_ok boolean;
  _expert_busy boolean;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT (status = 'active'), COALESCE(is_busy,false)
    INTO _expert_ok, _expert_busy
    FROM public.experts WHERE id = _expert_id FOR UPDATE;
  IF NOT COALESCE(_expert_ok, false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _expert_busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;

  SELECT status, assigned_expert_id
    INTO _current_status, _current_expert
    FROM public.bookings
    WHERE id = _booking_id
    FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _expert_id,
         status = 'expert_assigned'
   WHERE id = _booking_id
     AND status = 'accepted'
     AND assigned_expert_id IS NULL;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN RAISE EXCEPTION 'This booking has already been assigned'; END IF;

  UPDATE public.experts SET is_busy = true WHERE id = _expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'assigned_by_staff', 'bookings', _booking_id, _before, _after);
END;
$function$;

-- 5. staff_reassign_expert — swaps busy flags
CREATE OR REPLACE FUNCTION public.staff_reassign_expert(_booking_id uuid, _new_expert_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _expert_ok boolean;
  _new_busy boolean;
  _before jsonb;
  _after jsonb;
  _current_status text;
  _current_expert uuid;
  _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin', 'ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT (status = 'active'), COALESCE(is_busy,false)
    INTO _expert_ok, _new_busy
    FROM public.experts WHERE id = _new_expert_id FOR UPDATE;
  IF NOT COALESCE(_expert_ok,false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _new_busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;

  SELECT status, assigned_expert_id
    INTO _current_status, _current_expert
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current_status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking cannot be reassigned in its current state'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _new_expert_id
   WHERE id = _booking_id
     AND status = 'expert_assigned'
     AND assigned_expert_id = _current_expert;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN RAISE EXCEPTION 'Booking state changed, please refresh and try again'; END IF;

  -- Free the previous expert, mark the new one busy
  IF _current_expert IS NOT NULL AND _current_expert <> _new_expert_id THEN
    UPDATE public.experts SET is_busy = false WHERE id = _current_expert;
  END IF;
  UPDATE public.experts SET is_busy = true WHERE id = _new_expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reassigned_by_staff', 'bookings', _booking_id, _before, _after);
END;
$function$;

-- 6. get_eligible_experts_for_booking — excludes busy
CREATE OR REPLACE FUNCTION public.get_eligible_experts_for_booking(p_booking_id uuid)
 RETURNS TABLE(expert_id uuid, distance_km numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lat numeric;
  v_lng numeric;
  v_radius numeric;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.staff_users
    WHERE auth_user_id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  SELECT booking_lat, booking_lng INTO v_lat, v_lng
    FROM public.bookings WHERE id = p_booking_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN; END IF;

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  RETURN QUERY
    SELECT e.id, public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) AS distance_km
    FROM public.experts e
    WHERE e.is_online = true
      AND COALESCE(e.is_busy, false) = false
      AND e.current_lat IS NOT NULL
      AND e.current_lng IS NOT NULL
      AND e.status = 'active'
      AND public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) <= v_radius
    ORDER BY 2 ASC;
END;
$function$;

-- 7. Terminal-state transitions clear is_busy

-- expert_verify_end_otp
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
     SET status = 'completed',
         service_end_at = COALESCE(service_end_at, now()),
         updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, auth.uid());

    UPDATE public.experts
      SET wallet_balance = COALESCE(wallet_balance,0) + _payout
      WHERE id = _expert_id;
  END IF;

  RETURN _payout;
END $function$;

-- staff_verify_end_otp
CREATE OR REPLACE FUNCTION public.staff_verify_end_otp(_booking_id uuid, _otp text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _b record;
  _now timestamptz := now();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, status, end_otp, deleted_at, assigned_expert_id
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Booking has been deleted'; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking is not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_b.end_otp) = '' THEN RAISE EXCEPTION 'No end OTP set'; END IF;
  IF btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed',
         service_end_at = COALESCE(service_end_at, _now),
         updated_at = _now
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _b.assigned_expert_id IS NOT NULL THEN
    UPDATE public.experts SET is_busy = false WHERE id = _b.assigned_expert_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'staff_relayed_end_otp', 'bookings', _booking_id,
    jsonb_build_object('status', _b.status),
    jsonb_build_object('status', 'completed', 'completed_at', _now,
      'note', 'OTP relayed by expert via phone/WhatsApp; verified by staff (interim flow).'));
END;$function$;

-- staff_cancel_booking — free expert if one was assigned
CREATE OR REPLACE FUNCTION public.staff_cancel_booking(_booking_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current text;
  _assigned uuid;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _reason IS NULL OR _reason NOT IN ('SAFETY','FRAUD','DUPLICATE','MANUAL_OVERRIDE','OTHER') THEN
    RAISE EXCEPTION 'Invalid reason';
  END IF;

  SELECT to_jsonb(b), status, assigned_expert_id
    INTO _before, _current, _assigned
    FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current IN ('completed','cancelled','rejected') THEN
    RAISE EXCEPTION 'Booking already in terminal state: %', _current;
  END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET status = 'cancelled', cancellation_reason = _reason WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL AND _current IN ('expert_assigned','in_progress') THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'cancel_booking', 'bookings', _booking_id, _before, _after);
END;$function$;

-- expert_reject_booking — free expert (booking returns to 'accepted' pool)
CREATE OR REPLACE FUNCTION public.expert_reject_booking(_booking_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT id, assigned_expert_id, status
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking cannot be rejected now'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET assigned_expert_id = NULL,
         status = 'accepted',
         cancellation_reason = btrim(_reason)
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'expert_rejected_booking', 'bookings', _booking_id,
    jsonb_build_object('assigned_expert_id', _expert_id, 'status', 'expert_assigned'),
    jsonb_build_object('status', 'accepted', 'reason', btrim(_reason)));
END $function$;

-- staff_update_booking_status — clear busy on terminal transitions
CREATE OR REPLACE FUNCTION public.staff_update_booking_status(_booking_id uuid, _new_status text, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _current text;
  _assigned uuid;
  _before jsonb;
  _after jsonb;
  _allowed boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT to_jsonb(b), status, assigned_expert_id
    INTO _before, _current, _assigned
    FROM public.bookings b WHERE id = _booking_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  IF _current = 'confirmed' AND _new_status IN ('accepted','rejected','cancelled') THEN _allowed := true;
  ELSIF _current = 'accepted' AND _new_status IN ('expert_assigned','cancelled','rejected') THEN _allowed := true;
  ELSIF _current = 'expert_assigned' AND _new_status IN ('in_progress','cancelled') THEN _allowed := true;
  ELSIF _current = 'in_progress' AND _new_status IN ('completed','cancelled') THEN _allowed := true;
  END IF;

  IF NOT _allowed THEN RAISE EXCEPTION 'Invalid status transition from % to %', _current, _new_status; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET status = _new_status WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _assigned IS NOT NULL
     AND _new_status IN ('completed','cancelled','rejected')
     AND _current IN ('expert_assigned','in_progress') THEN
    UPDATE public.experts SET is_busy = false WHERE id = _assigned;
  END IF;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'update_booking_status', 'bookings', _booking_id,
          _before || jsonb_build_object('note', _note), _after);
END;
$function$;
