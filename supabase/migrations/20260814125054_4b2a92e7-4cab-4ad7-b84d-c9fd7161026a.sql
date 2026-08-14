CREATE OR REPLACE FUNCTION public.staff_decide_partner_skill(_skill_id uuid, _decision text, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _staff_id uuid;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';

  SELECT to_jsonb(s) INTO _before FROM public.partner_skills s WHERE s.id = _skill_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Skill request not found'; END IF;

  UPDATE public.partner_skills
     SET status = _decision,
         approved_by = _staff_id,
         approved_at = now()
   WHERE id = _skill_id;

  SELECT to_jsonb(s) INTO _after FROM public.partner_skills s WHERE s.id = _skill_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'partner_skill_' || _decision, 'partner_skills', _skill_id,
          _before, _after || jsonb_build_object('decision_notes', _notes));
END $function$;