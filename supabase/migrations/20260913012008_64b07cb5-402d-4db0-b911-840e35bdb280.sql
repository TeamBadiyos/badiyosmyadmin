CREATE OR REPLACE FUNCTION public.staff_notify_waitlist_area(_city text DEFAULT NULL, _segment_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE w record; _count integer := 0;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL::text[]) THEN RAISE EXCEPTION 'Not authorised'; END IF;

  FOR w IN
    SELECT * FROM public.waitlist_requests wr
     WHERE wr.notified_at IS NULL
       AND COALESCE(wr.status,'pending') IN ('pending','waiting')
       AND wr.user_id IS NOT NULL
       AND (_city IS NULL OR lower(COALESCE(wr.city,'')) = lower(_city))
       AND (_segment_id IS NULL OR wr.segment_id = _segment_id)
     LIMIT 500
  LOOP
    PERFORM public.notify_customer_user_push(
      w.user_id,
      'An expert is available near you',
      'Good news — an expert is now free in your area. Tap to book.',
      '/home'
    );
    INSERT INTO public.waitlist_notify_events (waitlist_id, city, segment_id, channel, payload)
    VALUES (w.id, w.city, w.segment_id, 'push',
      jsonb_build_object(
        'phone', (SELECT u.phone FROM public.users u WHERE u.id = w.user_id),
        'name',  (SELECT u.full_name FROM public.users u WHERE u.id = w.user_id),
        'city', w.city, 'area', w.address_text, 'manual', true));
    UPDATE public.waitlist_requests
       SET notified_at = now(), notify_count = COALESCE(notify_count,0) + 1
     WHERE id = w.id;
    _count := _count + 1;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'waitlist_manual_notify', 'waitlist_requests', NULL,
          jsonb_build_object('city', _city, 'segment_id', _segment_id, 'notified', _count));

  RETURN _count;
END;
$$;

CREATE OR REPLACE FUNCTION public.broadcast_booking_to_experts(_booking_id uuid, _radius numeric DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  _rad numeric;
  _duration_text text;
  _body text;
  _title text := 'New booking nearby';
  _count integer := 0;
  r record;
  _preferred uuid[];
  _notified uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RETURN 0; END IF;
  IF b.booking_lat IS NULL OR b.booking_lng IS NULL THEN RETURN 0; END IF;

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

  -- Priority: experts flagged as finishing soon for this booking (notified first,
  -- but never instead of genuinely free experts).
  SELECT array_agg(pe.expert_id) INTO _preferred
    FROM public.booking_preferred_experts pe
   WHERE pe.booking_id = b.id AND pe.expires_at > now();

  IF _preferred IS NOT NULL THEN
    FOR r IN
      SELECT e.id
        FROM public.experts e
       WHERE e.id = ANY(_preferred)
         AND e.status = 'active'
         AND e.is_online
    LOOP
      PERFORM public.notify_expert_broadcast(r.id, b.id, _title, _body);
      _notified := _notified || r.id;
      _count := _count + 1;
    END LOOP;
  END IF;

  _rad := COALESCE(_radius, b.current_search_radius_km);
  IF _rad IS NULL THEN
    SELECT broadcast_radius_km INTO _rad FROM public.dispatch_config LIMIT 1;
  END IF;
  IF _rad IS NULL THEN _rad := 5; END IF;

  FOR r IN
    SELECT e.id
    FROM public.experts e
    WHERE e.is_online = true
      AND COALESCE(e.is_busy,false) = false
      AND NOT (e.id = ANY(_notified))
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
$$;