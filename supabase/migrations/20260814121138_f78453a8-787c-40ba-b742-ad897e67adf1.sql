-- PART A/B schema
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_category_id uuid REFERENCES public.service_categories(id),
  ADD COLUMN IF NOT EXISTS current_search_radius_km numeric,
  ADD COLUMN IF NOT EXISTS broadcast_started_at timestamptz;

ALTER TABLE public.dispatch_config
  ADD COLUMN IF NOT EXISTS radius_expand_step_km numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS radius_expand_max_km numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS radius_expand_after_seconds integer NOT NULL DEFAULT 60;

-- Shared broadcast routine
CREATE OR REPLACE FUNCTION public.broadcast_booking_to_experts(_booking_id uuid, _radius numeric DEFAULT NULL)
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
  _clean_id uuid;
  _skill_required boolean := false;
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

  SELECT id INTO _clean_id FROM public.service_categories WHERE slug = 'clean' LIMIT 1;
  IF b.service_category_id IS NOT NULL
     AND (_clean_id IS NULL OR b.service_category_id <> _clean_id) THEN
    _skill_required := true;
  END IF;

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
        _skill_required = false
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

-- Trigger now stamps radius/started_at and delegates to shared routine
CREATE OR REPLACE FUNCTION public.on_booking_broadcast_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _radius numeric;
BEGIN
  IF NEW.status <> 'accepted' THEN RETURN NEW; END IF;
  IF NEW.assigned_expert_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.booking_lat IS NULL OR NEW.booking_lng IS NULL THEN RETURN NEW; END IF;

  SELECT broadcast_radius_km INTO _radius FROM public.dispatch_config LIMIT 1;
  IF _radius IS NULL THEN _radius := 5; END IF;

  UPDATE public.bookings
    SET current_search_radius_km = COALESCE(current_search_radius_km, _radius),
        broadcast_started_at = COALESCE(broadcast_started_at, now())
    WHERE id = NEW.id;

  PERFORM public.broadcast_booking_to_experts(NEW.id, _radius);

  RETURN NEW;
END;
$function$;

-- Eligible experts list: same skill filter, honours current search radius
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
  v_clean uuid;
  v_skill_required boolean := false;
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

  SELECT id INTO v_clean FROM public.service_categories WHERE slug = 'clean' LIMIT 1;
  IF v_cat IS NOT NULL AND (v_clean IS NULL OR v_cat <> v_clean) THEN
    v_skill_required := true;
  END IF;

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
        v_skill_required = false
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

-- Manual radius auto-expand
CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg record;
  b record;
  _new_radius numeric;
  _expanded integer := 0;
BEGIN
  SELECT * INTO cfg FROM public.dispatch_config LIMIT 1;
  IF cfg.id IS NULL THEN RETURN 0; END IF;

  FOR b IN
    SELECT id, COALESCE(current_search_radius_km, cfg.broadcast_radius_km) AS radius
    FROM public.bookings
    WHERE status = 'accepted'
      AND assigned_expert_id IS NULL
      AND deleted_at IS NULL
      AND broadcast_started_at IS NOT NULL
      AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  LOOP
    _new_radius := LEAST(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    UPDATE public.bookings SET current_search_radius_km = _new_radius WHERE id = b.id;
    PERFORM public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  END LOOP;

  RETURN _expanded;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_booking_to_experts(uuid, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.expand_stale_broadcasts() FROM public, anon, authenticated;