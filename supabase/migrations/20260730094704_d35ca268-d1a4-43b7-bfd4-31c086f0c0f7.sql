CREATE OR REPLACE FUNCTION public.staff_redraw_zone_boundary(_zone_id uuid, _boundary jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF _boundary IS NULL OR jsonb_typeof(_boundary) <> 'array' OR jsonb_array_length(_boundary) < 3 THEN
    RAISE EXCEPTION 'Boundary must have at least 3 points';
  END IF;

  SELECT to_jsonb(z) INTO _before FROM public.zones z WHERE id = _zone_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  IF (_before->>'deleted_at') IS NOT NULL THEN RAISE EXCEPTION 'Zone has been deleted'; END IF;

  UPDATE public.zones SET boundary = _boundary WHERE id = _zone_id;

  SELECT to_jsonb(z) INTO _after FROM public.zones z WHERE id = _zone_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'redraw_zone_boundary', 'zones', _zone_id,
          jsonb_build_object('boundary', _before->'boundary'),
          jsonb_build_object('boundary', _after->'boundary'));
END;$function$;

GRANT EXECUTE ON FUNCTION public.staff_redraw_zone_boundary(uuid, jsonb) TO authenticated;