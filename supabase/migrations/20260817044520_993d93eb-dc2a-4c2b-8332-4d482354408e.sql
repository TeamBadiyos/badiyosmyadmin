CREATE OR REPLACE FUNCTION public.staff_assign_partner_skill(_expert_id uuid, _service_category_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _staff_id uuid;
  _id uuid;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';

  IF NOT EXISTS (SELECT 1 FROM public.experts WHERE id = _expert_id) THEN
    RAISE EXCEPTION 'Expert not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_categories WHERE id = _service_category_id AND is_active) THEN
    RAISE EXCEPTION 'Service category not found or inactive';
  END IF;

  SELECT id, to_jsonb(s) INTO _id, _before
    FROM public.partner_skills s
   WHERE s.expert_id = _expert_id AND s.service_category_id = _service_category_id
   ORDER BY s.created_at DESC LIMIT 1;

  IF _id IS NULL THEN
    INSERT INTO public.partner_skills (expert_id, service_category_id, status, approved_by, approved_at)
    VALUES (_expert_id, _service_category_id, 'approved', _staff_id, now())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.partner_skills
       SET status = 'approved', approved_by = _staff_id, approved_at = now()
     WHERE id = _id;
  END IF;

  SELECT to_jsonb(s) INTO _after FROM public.partner_skills s WHERE s.id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'partner_skill_assigned', 'partner_skills', _id, _before, _after);

  RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.staff_assign_partner_skill(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_assign_partner_skill(uuid, uuid) TO authenticated, service_role;