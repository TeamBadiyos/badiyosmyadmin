
-- 1) Resolve the booking's service category from the catalogue hierarchy when not supplied
CREATE OR REPLACE FUNCTION public.bookings_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _price numeric;
  _addr_lat numeric;
  _addr_lng numeric;
  _bypass text;
  _cat uuid;
BEGIN
  BEGIN _bypass := current_setting('app.booking_bypass', true); EXCEPTION WHEN OTHERS THEN _bypass := NULL; END;

  SELECT price INTO _price FROM public.service_catalogue_config
   WHERE duration_minutes = NEW.service_duration_minutes AND is_active = true
   ORDER BY created_at DESC LIMIT 1;
  IF _price IS NULL THEN
    RAISE EXCEPTION 'Invalid service duration';
  END IF;
  NEW.price := _price;
  NEW.status := 'confirmed';
  NEW.rating := NULL;
  NEW.review_text := NULL;

  IF _bypass IS DISTINCT FROM 'on' THEN
    NEW.assigned_expert_id := NULL;
    NEW.razorpay_order_id := NULL;
    NEW.razorpay_payment_id := NULL;
    NEW.refund_id := NULL;
    NEW.refund_status := NULL;
    NEW.refund_amount := NULL;
    NEW.cancellation_fee := NULL;
    NEW.cancellation_reason := NULL;
    NEW.cancelled_by := NULL;
    NEW.cancelled_at := NULL;
    NEW.started_at := NULL;
    NEW.service_end_at := NULL;
    NEW.start_otp := NULL;
    NEW.end_otp := NULL;
    NEW.broadcast_started_at := NULL;
    NEW.current_search_radius_km := NULL;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.delete_reason := NULL;
  END IF;

  -- Resolve service_category_id: catalogue item (service_price_options -> services -> service_categories)
  -- matched by label first, then duration; finally fall back to service_catalogue_config.
  IF NEW.service_category_id IS NULL THEN
    SELECT sv.category_id INTO _cat
      FROM public.service_price_options spo
      JOIN public.services sv ON sv.id = spo.service_id
      JOIN public.service_categories sc ON sc.id = sv.category_id
     WHERE spo.is_active = true AND sv.is_active = true AND sc.is_active = true
       AND lower(spo.label) = lower(COALESCE(NEW.service_label, ''))
     ORDER BY spo.display_order
     LIMIT 1;

    IF _cat IS NULL AND NEW.service_duration_minutes IS NOT NULL THEN
      SELECT sv.category_id INTO _cat
        FROM public.service_price_options spo
        JOIN public.services sv ON sv.id = spo.service_id
        JOIN public.service_categories sc ON sc.id = sv.category_id
       WHERE spo.is_active = true AND sv.is_active = true AND sc.is_active = true
         AND spo.duration_minutes = NEW.service_duration_minutes
       ORDER BY spo.display_order
       LIMIT 1;
    END IF;

    IF _cat IS NULL THEN
      SELECT scc.service_category_id INTO _cat
        FROM public.service_catalogue_config scc
       WHERE scc.is_active = true
         AND scc.duration_minutes = NEW.service_duration_minutes
         AND scc.service_category_id IS NOT NULL
       ORDER BY scc.created_at DESC
       LIMIT 1;
    END IF;

    NEW.service_category_id := _cat;
  END IF;

  IF (NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL) AND NEW.address_id IS NOT NULL THEN
    SELECT latitude, longitude INTO _addr_lat, _addr_lng
      FROM public.addresses WHERE id = NEW.address_id;
    IF NEW.booking_lat IS NULL THEN NEW.booking_lat := _addr_lat; END IF;
    IF NEW.booking_lng IS NULL THEN NEW.booking_lng := _addr_lng; END IF;
  END IF;

  IF NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL THEN
    RAISE EXCEPTION 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      USING ERRCODE = 'check_violation', HINT = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Broadcast: skill filter applies to every categorised booking (no 'clean' exemption)
CREATE OR REPLACE FUNCTION public.broadcast_booking_to_experts(_booking_id uuid, _radius numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  b record;
  _rad numeric;
  _duration_text text;
  _body text;
  _title text := 'New booking nearby';
  _count integer := 0;
  r record;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RETURN 0; END IF;
  IF b.booking_lat IS NULL OR b.booking_lng IS NULL THEN RETURN 0; END IF;

  _rad := COALESCE(_radius, b.current_search_radius_km);
  IF _rad IS NULL THEN
    SELECT broadcast_radius_km INTO _rad FROM public.dispatch_config LIMIT 1;
  END IF;
  IF _rad IS NULL THEN _rad := 5; END IF;

  IF b.service_duration_minutes IS NOT NULL THEN
    IF b.service_duration_minutes >= 60 AND b.service_duration_minutes % 60 = 0 THEN
      _duration_text := (b.service_duration_minutes / 60)::text || 'h';
    ELSE
      _duration_text := b.service_duration_minutes::text || ' min';
    END IF;
  ELSE
    _duration_text := 'A';
  END IF;
  _body := _duration_text || ' booking available near you — tap to view.';

  FOR r IN
    SELECT e.id
    FROM public.experts e
    WHERE e.is_online = true
      AND COALESCE(e.is_busy,false) = false
      AND e.current_lat IS NOT NULL
      AND e.current_lng IS NOT NULL
      AND e.status = 'active'
      AND public.haversine_km(e.current_lat, e.current_lng, b.booking_lat, b.booking_lng) <= _rad
      AND (
        b.service_category_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.partner_skills ps
          WHERE ps.expert_id = e.id
            AND ps.status = 'approved'
            AND ps.service_category_id = b.service_category_id
        )
      )
  LOOP
    PERFORM public.notify_expert_broadcast(r.id, b.id, _title, _body);
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$function$;

-- 3) Staff eligibility list: same rule
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
  v_cat uuid;
  v_staleness interval := interval '15 minutes';
BEGIN
  SELECT role INTO v_role FROM public.staff_users
    WHERE auth_user_id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  SELECT booking_lat, booking_lng, service_category_id, current_search_radius_km
    INTO v_lat, v_lng, v_cat, v_radius
    FROM public.bookings WHERE id = p_booking_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN RETURN; END IF;

  IF v_radius IS NULL THEN
    SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  END IF;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  RETURN QUERY
    SELECT e.id, public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) AS distance_km
    FROM public.experts e
    WHERE e.is_online = true
      AND COALESCE(e.is_busy, false) = false
      AND e.current_lat IS NOT NULL
      AND e.current_lng IS NOT NULL
      AND e.status = 'active'
      AND (e.location_updated_at IS NULL OR e.location_updated_at > now() - v_staleness)
      AND public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) <= v_radius
      AND (
        v_cat IS NULL
        OR EXISTS (
          SELECT 1 FROM public.partner_skills ps
          WHERE ps.expert_id = e.id
            AND ps.status = 'approved'
            AND ps.service_category_id = v_cat
        )
      )
    ORDER BY 2 ASC;
END;
$function$;

-- 4) Enforce the same rule at claim time (the RPC is directly callable)
CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(p_booking_id uuid)
 RETURNS bookings
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
  v_cat uuid;
  v_row public.bookings;
  v_expert_name text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  IF v_expert_id IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  SELECT current_lat, current_lng, is_busy, name
    INTO v_exp_lat, v_exp_lng, v_is_busy, v_expert_name
    FROM public.experts WHERE id = v_expert_id FOR UPDATE;

  IF v_is_busy THEN
    RAISE EXCEPTION 'You already have an active booking. Complete it before accepting a new one.';
  END IF;
  IF v_exp_lat IS NULL OR v_exp_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  SELECT booking_lat, booking_lng, status, assigned_expert_id, service_category_id
    INTO v_bk_lat, v_bk_lng, v_current_status, v_current_assigned, v_cat
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_bk_lat IS NULL OR v_bk_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  IF v_cat IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partner_skills ps
    WHERE ps.expert_id = v_expert_id
      AND ps.status = 'approved'
      AND ps.service_category_id = v_cat
  ) THEN
    RAISE EXCEPTION 'You are not approved for this service category.';
  END IF;

  v_distance := public.haversine_km(v_exp_lat, v_exp_lng, v_bk_lat, v_bk_lng);
  IF v_distance > v_radius THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  IF v_current_status <> 'accepted' OR v_current_assigned IS NOT NULL THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  SELECT to_jsonb(b) INTO v_before FROM public.bookings b WHERE id = p_booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
    SET assigned_expert_id = v_expert_id,
        status = 'expert_assigned',
        updated_at = now()
    WHERE id = p_booking_id AND status = 'accepted' AND assigned_expert_id IS NULL
    RETURNING * INTO v_row;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  UPDATE public.experts SET is_busy = true WHERE id = v_expert_id;

  SELECT to_jsonb(b) INTO v_after FROM public.bookings b WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    auth.uid(), 'claim_booking', 'bookings', p_booking_id, v_before,
    v_after || jsonb_build_object('actor_role', 'expert', 'expert_id', v_expert_id, 'distance_km', v_distance)
  );

  PERFORM public.notify_customer_push(
    p_booking_id,
    'Expert assigned!',
    COALESCE(v_expert_name, 'Your expert') || ' is on the way for your booking.',
    'booking/' || p_booking_id::text
  );

  RETURN v_row;
END;
$function$;
