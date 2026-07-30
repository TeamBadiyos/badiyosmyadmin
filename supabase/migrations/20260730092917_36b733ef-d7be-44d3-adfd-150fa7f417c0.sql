ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE OR REPLACE FUNCTION public.resolve_zone_for_point(_lat numeric, _lng numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _zone_id uuid;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _zone_id
    FROM public.zones
   WHERE status = 'active'
     AND deleted_at IS NULL
     AND public.point_in_polygon(_lat, _lng, boundary)
   ORDER BY created_at ASC
   LIMIT 1;
  RETURN _zone_id;
END;$function$;

CREATE OR REPLACE FUNCTION public.zone_delete_impact(_zone_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _experts int;
  _partner uuid;
  _bookings int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT count(*) INTO _experts FROM public.experts
    WHERE zone_id = _zone_id AND status = 'active';
  SELECT assigned_area_partner_id INTO _partner FROM public.zones WHERE id = _zone_id;
  SELECT count(*) INTO _bookings FROM public.bookings
    WHERE zone_id = _zone_id
      AND status NOT IN ('completed','cancelled','rejected')
      AND deleted_at IS NULL;
  RETURN jsonb_build_object(
    'active_experts', COALESCE(_experts,0),
    'has_partner', _partner IS NOT NULL,
    'open_bookings', COALESCE(_bookings,0)
  );
END;$function$;

CREATE OR REPLACE FUNCTION public.staff_update_zone(_zone_id uuid, _payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _before jsonb;
  _after jsonb;
  _name text;
  _city text;
  _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT to_jsonb(z) INTO _before FROM public.zones z WHERE id = _zone_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Zone has been deleted'; END IF;

  _name := NULLIF(btrim(COALESCE(_payload->>'name','')), '');
  _city := NULLIF(btrim(COALESCE(_payload->>'city','')), '');
  _status := COALESCE(_payload->>'status', _before->>'status');

  IF _name IS NULL THEN RAISE EXCEPTION 'Zone name is required'; END IF;
  IF _city IS NULL THEN RAISE EXCEPTION 'City is required'; END IF;
  IF _status NOT IN ('active','inactive') THEN RAISE EXCEPTION 'Invalid status'; END IF;

  UPDATE public.zones
     SET name = _name, city = _city, status = _status
   WHERE id = _zone_id;

  SELECT to_jsonb(z) INTO _after FROM public.zones z WHERE id = _zone_id;

  IF _after IS DISTINCT FROM _before THEN
    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'update_zone', 'zones', _zone_id, _before, _after);
  END IF;
END;$function$;

CREATE OR REPLACE FUNCTION public.staff_soft_delete_zone(_zone_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _before jsonb;
  _after jsonb;
  _unassigned int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT to_jsonb(z) INTO _before FROM public.zones z WHERE id = _zone_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Zone already deleted'; END IF;

  UPDATE public.experts SET zone_id = NULL WHERE zone_id = _zone_id;
  GET DIAGNOSTICS _unassigned = ROW_COUNT;

  UPDATE public.zones
     SET deleted_at = now(),
         deleted_by = _uid,
         delete_reason = btrim(_reason),
         status = 'inactive',
         assigned_area_partner_id = NULL
   WHERE id = _zone_id;

  SELECT to_jsonb(z) INTO _after FROM public.zones z WHERE id = _zone_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'soft_delete_zone', 'zones', _zone_id, _before,
          _after || jsonb_build_object('experts_unassigned', _unassigned));
END;$function$;

CREATE OR REPLACE FUNCTION public.staff_assign_area_partner(_zone_id uuid, _partner_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _partner_ok boolean;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _partner_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.area_partners WHERE id=_partner_id AND status='active') INTO _partner_ok;
    IF NOT _partner_ok THEN RAISE EXCEPTION 'Area partner not available'; END IF;
  END IF;
  SELECT to_jsonb(z) INTO _before FROM public.zones z WHERE id = _zone_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Zone has been deleted'; END IF;
  UPDATE public.zones SET assigned_area_partner_id = _partner_id WHERE id = _zone_id;
  SELECT to_jsonb(z) INTO _after FROM public.zones z WHERE id = _zone_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'assign_area_partner', 'zones', _zone_id, _before, _after);
END;$function$;