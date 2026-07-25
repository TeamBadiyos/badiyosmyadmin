
DROP FUNCTION IF EXISTS public.expert_update_location(numeric, numeric);
DROP FUNCTION IF EXISTS public.claim_booking_as_expert(uuid);
DROP FUNCTION IF EXISTS public.get_eligible_experts_for_booking(uuid);

CREATE OR REPLACE FUNCTION public.get_eligible_experts_for_booking(p_booking_id uuid)
RETURNS TABLE(expert_id uuid, distance_km numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lat numeric;
  v_lng numeric;
  v_radius numeric;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.staff_users
    WHERE auth_user_id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT booking_lat, booking_lng INTO v_lat, v_lng
    FROM public.bookings WHERE id = p_booking_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'Booking has no location';
  END IF;

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  RETURN QUERY
    SELECT e.id, public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) AS distance_km
    FROM public.experts e
    WHERE e.is_online = true
      AND e.current_lat IS NOT NULL
      AND e.current_lng IS NOT NULL
      AND e.status = 'active'
      AND public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) <= v_radius
    ORDER BY 2 ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_eligible_experts_for_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_eligible_experts_for_booking(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expert_id uuid;
  v_exp_lat numeric;
  v_exp_lng numeric;
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

  SELECT current_lat, current_lng INTO v_exp_lat, v_exp_lng
    FROM public.experts WHERE id = v_expert_id;
  IF v_exp_lat IS NULL OR v_exp_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  SELECT booking_lat, booking_lng, status, assigned_expert_id
    INTO v_bk_lat, v_bk_lng, v_current_status, v_current_assigned
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

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

  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'expert', 'claim_booking', 'booking', p_booking_id,
          jsonb_build_object('expert_id', v_expert_id, 'distance_km', v_distance));

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_booking_as_expert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_booking_as_expert(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.expert_update_location(p_lat numeric, p_lng numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expert_id uuid;
BEGIN
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  IF v_expert_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'Latitude and longitude are required';
  END IF;

  UPDATE public.experts
    SET current_lat = p_lat,
        current_lng = p_lng,
        location_updated_at = now()
    WHERE id = v_expert_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expert_update_location(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expert_update_location(numeric, numeric) TO authenticated;
