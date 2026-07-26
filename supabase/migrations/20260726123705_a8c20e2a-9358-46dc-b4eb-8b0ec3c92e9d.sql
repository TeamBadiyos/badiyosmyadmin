
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
  v_staleness interval := interval '15 minutes';
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
      AND (e.location_updated_at IS NULL OR e.location_updated_at > now() - v_staleness)
      AND public.haversine_km(e.current_lat, e.current_lng, v_lat, v_lng) <= v_radius
    ORDER BY 2 ASC;
END;
$function$;
