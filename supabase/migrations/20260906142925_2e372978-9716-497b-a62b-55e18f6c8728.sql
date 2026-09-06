
CREATE OR REPLACE FUNCTION public.staff_set_partner_zones(_partner_id uuid, _zone_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _before uuid[]; _ids uuid[] := COALESCE(_zone_ids, ARRAY[]::uuid[]);
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.area_partners WHERE id = _partner_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Area partner not found';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO _before
    FROM public.zones WHERE assigned_area_partner_id = _partner_id;

  UPDATE public.zones
     SET assigned_area_partner_id = NULL
   WHERE assigned_area_partner_id = _partner_id
     AND NOT (id = ANY(_ids));

  UPDATE public.zones
     SET assigned_area_partner_id = _partner_id
   WHERE id = ANY(_ids)
     AND deleted_at IS NULL;

  UPDATE public.area_partners
     SET zone_id = (SELECT id FROM public.zones WHERE assigned_area_partner_id = _partner_id ORDER BY name LIMIT 1)
   WHERE id = _partner_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'set_partner_zones', 'area_partners', _partner_id,
         jsonb_build_object('zone_ids', _before), jsonb_build_object('zone_ids', _ids));
END $$;

REVOKE ALL ON FUNCTION public.staff_set_partner_zones(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_partner_zones(uuid, uuid[]) TO authenticated;
