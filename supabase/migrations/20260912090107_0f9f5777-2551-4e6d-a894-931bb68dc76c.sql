
-- 1. Dispatch config additions
ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS no_accept_alert_threshold_seconds integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS aisensy_template_name text,
  ADD COLUMN IF NOT EXISTS ops_alert_whatsapp_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS almost_available_window_minutes integer NOT NULL DEFAULT 10;

-- 2. Capacity messages
CREATE TABLE public.capacity_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_key text NOT NULL,
  message_text text NOT NULL,
  city text NOT NULL DEFAULT 'Latur',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_key, city)
);
GRANT SELECT ON public.capacity_messages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_messages TO authenticated;
GRANT ALL ON public.capacity_messages TO service_role;
ALTER TABLE public.capacity_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active capacity messages"
  ON public.capacity_messages FOR SELECT TO anon
  USING (is_active = true);
CREATE POLICY "Staff can read all capacity messages"
  ON public.capacity_messages FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));
CREATE POLICY "Staff can manage capacity messages"
  ON public.capacity_messages FOR ALL TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL))
  WITH CHECK (public.is_active_staff(auth.uid(), NULL));

INSERT INTO public.capacity_messages (message_key, message_text, city, is_active)
VALUES ('default', 'All our experts are currently busy in your area. You can join the waitlist and we will notify you as soon as an expert is free, schedule for a later time, or cancel for a full refund.', 'Latur', true);

-- 3. Alert history
CREATE TABLE public.dispatch_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  city text,
  zone_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  whatsapp_sent boolean NOT NULL DEFAULT false,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_alert_events_type_check CHECK (alert_type IN ('no_accept','zero_capacity'))
);
CREATE UNIQUE INDEX dispatch_alert_events_booking_type_key
  ON public.dispatch_alert_events (booking_id, alert_type);
GRANT SELECT ON public.dispatch_alert_events TO authenticated;
GRANT ALL ON public.dispatch_alert_events TO service_role;
ALTER TABLE public.dispatch_alert_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read dispatch alerts"
  ON public.dispatch_alert_events FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));

-- 4. Preferred (soon-to-be-free) experts per booking
CREATE TABLE public.booking_preferred_experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, expert_id)
);
GRANT SELECT ON public.booking_preferred_experts TO authenticated;
GRANT ALL ON public.booking_preferred_experts TO service_role;
ALTER TABLE public.booking_preferred_experts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read preferred experts"
  ON public.booking_preferred_experts FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));

-- 5. Raise a dispatch alert (deduped once per booking+type)
CREATE OR REPLACE FUNCTION public.raise_dispatch_alert(_booking_id uuid, _type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b record;
  _inserted uuid;
  _title text;
  _detail text;
BEGIN
  IF _type NOT IN ('no_accept','zero_capacity') THEN
    RAISE EXCEPTION 'Invalid alert type %', _type;
  END IF;
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RETURN false; END IF;

  INSERT INTO public.dispatch_alert_events (booking_id, alert_type, city, zone_id, payload)
  VALUES (
    b.id, _type, b.zone_id IS NOT NULL AND false OR NULL, b.zone_id,
    jsonb_build_object('service_label', b.service_label, 'price', b.price)
  )
  ON CONFLICT (booking_id, alert_type) DO NOTHING
  RETURNING id INTO _inserted;

  -- fill city from zone when available
  UPDATE public.dispatch_alert_events e
     SET city = z.city
    FROM public.zones z
   WHERE e.id = _inserted AND e.zone_id = z.id;

  IF _inserted IS NULL THEN RETURN false; END IF;

  IF _type = 'no_accept' THEN
    _title := 'No expert accepted yet';
    _detail := coalesce(b.service_label,'Booking')||' — waiting longer than the alert threshold';
  ELSE
    _title := 'Zero capacity in zone';
    _detail := coalesce(b.service_label,'Booking')||' — no experts online or finishing soon';
  END IF;

  INSERT INTO public.staff_notifications (notif_key, kind, title, detail, target, target_id, event_at)
  VALUES ('dispatch:'||_type||':'||b.id, 'dispatch', _title, _detail, 'bookings', b.id, now())
  ON CONFLICT (notif_key) DO NOTHING;

  IF _type = 'no_accept' THEN
    PERFORM set_config('app.booking_bypass','on',true);
    UPDATE public.bookings SET dispatch_alert_sent = true WHERE id = b.id;
    PERFORM set_config('app.booking_bypass','off',true);
  END IF;

  RETURN true;
END;
$function$;

-- 6. Evaluate zone capacity for a booking (radius parity with dispatch)
CREATE OR REPLACE FUNCTION public.evaluate_zone_capacity(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b record;
  cfg record;
  _rad numeric;
  _window integer;
  _online integer;
  _city text;
  _msg text;
  _preferred uuid[] := '{}';
  r record;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN
    RETURN jsonb_build_object('verdict','unknown','message',null);
  END IF;

  SELECT z.city INTO _city FROM public.zones z WHERE z.id = b.zone_id;
  SELECT * INTO cfg FROM public.dispatch_config
   WHERE (_city IS NULL) OR (city = _city)
   ORDER BY (city = _city) DESC NULLS LAST
   LIMIT 1;

  -- Same effective radius the broadcast uses right now (includes expansion).
  _rad := COALESCE(b.current_search_radius_km, cfg.broadcast_radius_km, 5);
  _window := COALESCE(cfg.almost_available_window_minutes, 10);

  IF b.booking_lat IS NULL OR b.booking_lng IS NULL THEN
    RETURN jsonb_build_object('verdict','available','message',null,'radius_km',_rad);
  END IF;

  -- Experts online, free, eligible (skill-gated) inside the effective radius
  SELECT count(*) INTO _online
    FROM public.experts e
   WHERE e.is_online AND COALESCE(e.is_busy,false) = false
     AND e.status = 'active'
     AND e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL
     AND public.haversine_km(e.current_lat, e.current_lng, b.booking_lat, b.booking_lng) <= _rad
     AND (b.service_category_id IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_skills ps
            WHERE ps.expert_id = e.id AND ps.status = 'approved'
              AND ps.service_category_id = b.service_category_id));

  IF _online > 0 THEN
    RETURN jsonb_build_object('verdict','available','message',null,'radius_km',_rad,'online_experts',_online);
  END IF;

  -- Busy experts finishing soon (current job ETA within window)
  FOR r IN
    SELECT DISTINCT e.id AS expert_id,
           (jb.started_at + make_interval(mins => COALESCE(jb.service_duration_minutes, 60))) AS free_at
      FROM public.experts e
      JOIN public.bookings jb
        ON jb.assigned_expert_id = e.id
       AND jb.status IN ('accepted','expert_assigned','in_progress')
       AND jb.started_at IS NOT NULL
       AND jb.deleted_at IS NULL
     WHERE e.is_online AND COALESCE(e.is_busy,false) = true
       AND e.status = 'active'
       AND e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL
       AND public.haversine_km(e.current_lat, e.current_lng, b.booking_lat, b.booking_lng) <= _rad
       AND (b.service_category_id IS NULL OR EXISTS (
             SELECT 1 FROM public.partner_skills ps
              WHERE ps.expert_id = e.id AND ps.status = 'approved'
                AND ps.service_category_id = b.service_category_id))
       AND (jb.started_at + make_interval(mins => COALESCE(jb.service_duration_minutes, 60)))
           BETWEEN now() AND now() + make_interval(mins => _window)
  LOOP
    INSERT INTO public.booking_preferred_experts (booking_id, expert_id, expires_at)
    VALUES (b.id, r.expert_id, r.free_at + interval '5 minutes')
    ON CONFLICT (booking_id, expert_id) DO UPDATE SET expires_at = EXCLUDED.expires_at;
    _preferred := _preferred || r.expert_id;
  END LOOP;

  IF array_length(_preferred, 1) > 0 THEN
    RETURN jsonb_build_object('verdict','almost_available','message',null,'radius_km',_rad,'preferred_experts',_preferred);
  END IF;

  -- Zero capacity: resolve message (active situational override beats default)
  SELECT m.message_text INTO _msg
    FROM public.capacity_messages m
   WHERE m.is_active
     AND (m.city = COALESCE(_city, m.city))
     AND m.message_key <> 'default'
   ORDER BY m.updated_at DESC
   LIMIT 1;
  IF _msg IS NULL THEN
    SELECT m.message_text INTO _msg
      FROM public.capacity_messages m
     WHERE m.is_active AND m.message_key = 'default'
     ORDER BY (m.city = COALESCE(_city,'')) DESC, m.updated_at DESC
     LIMIT 1;
  END IF;

  PERFORM public.raise_dispatch_alert(b.id, 'zero_capacity');

  RETURN jsonb_build_object('verdict','zero_capacity','message',_msg,'radius_km',_rad,'city',_city);
END;
$function$;

-- 7. Public wrapper the customer app calls after booking/payment
CREATE OR REPLACE FUNCTION public.check_booking_capacity(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- only meaningful while the booking is unassigned
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings
     WHERE id = _booking_id AND assigned_expert_id IS NULL AND deleted_at IS NULL
       AND status IN ('confirmed','accepted')
  ) THEN
    RETURN jsonb_build_object('verdict','assigned_or_closed','message',null);
  END IF;
  RETURN public.evaluate_zone_capacity(_booking_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.check_booking_capacity(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.check_booking_capacity(uuid) TO authenticated;

-- 8. Cron helper: find no-accept timeouts and raise alerts (once per booking)
CREATE OR REPLACE FUNCTION public.system_check_no_accept_alerts()
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b record;
  _threshold integer;
BEGIN
  FOR b IN
    SELECT bk.id, bk.broadcast_started_at, bk.zone_id
      FROM public.bookings bk
     WHERE bk.status IN ('confirmed','accepted')
       AND bk.assigned_expert_id IS NULL
       AND bk.deleted_at IS NULL
       AND bk.broadcast_started_at IS NOT NULL
       AND COALESCE(bk.dispatch_alert_sent, false) = false
  LOOP
    SELECT COALESCE(cfg.no_accept_alert_threshold_seconds, 180) INTO _threshold
      FROM public.zones z
      LEFT JOIN public.dispatch_config cfg ON cfg.city = z.city
     WHERE z.id = b.zone_id;
    _threshold := COALESCE(_threshold,
      (SELECT COALESCE(no_accept_alert_threshold_seconds,180) FROM public.dispatch_config LIMIT 1), 180);

    IF b.broadcast_started_at <= now() - make_interval(secs => _threshold) THEN
      IF public.raise_dispatch_alert(b.id, 'no_accept') THEN
        RETURN NEXT b.id;
      END IF;
    END IF;
  END LOOP;
END;
$function$;

-- 9. Pending WhatsApp dispatches for the route worker
CREATE OR REPLACE FUNCTION public.system_pending_dispatch_whatsapp()
RETURNS TABLE(event_id uuid, booking_id uuid, alert_type text, city text, template_name text, numbers text[], service_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id, e.booking_id, e.alert_type, e.city,
         cfg.aisensy_template_name, cfg.ops_alert_whatsapp_numbers,
         bk.service_label
    FROM public.dispatch_alert_events e
    JOIN public.bookings bk ON bk.id = e.booking_id
    LEFT JOIN public.dispatch_config cfg ON cfg.city = e.city
   WHERE e.whatsapp_sent = false
   ORDER BY e.triggered_at
   LIMIT 50;
$function$;

CREATE OR REPLACE FUNCTION public.system_mark_dispatch_whatsapp(_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.dispatch_alert_events SET whatsapp_sent = true WHERE id = _event_id;
$function$;

-- 10. Staff settings RPCs
CREATE OR REPLACE FUNCTION public.staff_update_dispatch_config(_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := (_payload->>'id')::uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _id IS NULL THEN RAISE EXCEPTION 'id required'; END IF;

  UPDATE public.dispatch_config SET
    no_accept_alert_threshold_seconds = COALESCE((_payload->>'no_accept_alert_threshold_seconds')::integer, no_accept_alert_threshold_seconds),
    aisensy_template_name = COALESCE(_payload->>'aisensy_template_name', aisensy_template_name),
    ops_alert_whatsapp_numbers = COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(_payload->'ops_alert_whatsapp_numbers','[]'::jsonb))), ops_alert_whatsapp_numbers),
    almost_available_window_minutes = COALESCE((_payload->>'almost_available_window_minutes')::integer, almost_available_window_minutes),
    updated_at = now()
  WHERE id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_dispatch_config', 'dispatch_config', _id, NULL, _payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_save_capacity_message(_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid := NULLIF(_payload->>'id','')::uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), NULL) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF coalesce(_payload->>'delete','false') = 'true' THEN
    DELETE FROM public.capacity_messages WHERE id = _id;
    RETURN;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.capacity_messages (message_key, message_text, city, is_active)
    VALUES (
      COALESCE(NULLIF(_payload->>'message_key',''), 'msg_'||gen_random_uuid()::text),
      COALESCE(_payload->>'message_text',''),
      COALESCE(NULLIF(_payload->>'city',''), 'Latur'),
      COALESCE((_payload->>'is_active')::boolean, false)
    );
  ELSE
    UPDATE public.capacity_messages SET
      message_text = COALESCE(_payload->>'message_text', message_text),
      city = COALESCE(NULLIF(_payload->>'city',''), city),
      is_active = COALESCE((_payload->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = _id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'save_capacity_message', 'capacity_messages', _id, NULL, _payload);
END;
$function$;

-- 11. Broadcast prefers soon-to-be-free experts before widening
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
  _preferred uuid[];
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

  -- Priority: experts flagged as finishing soon for this booking
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
      _count := _count + 1;
    END LOOP;
    IF _count > 0 THEN RETURN _count; END IF;
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
