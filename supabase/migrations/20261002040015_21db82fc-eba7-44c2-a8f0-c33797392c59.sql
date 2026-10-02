ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS jacket_issued boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jacket_issued_at date,
  ADD COLUMN IF NOT EXISTS joining_date date,
  ADD COLUMN IF NOT EXISTS training_progress jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.staff_set_expert_onboarding(_expert_id uuid, _payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object('jacket_issued', jacket_issued, 'jacket_issued_at', jacket_issued_at,
    'joining_date', joining_date, 'training_progress', training_progress)
    INTO _before FROM public.experts WHERE id = _expert_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;
  IF jsonb_typeof(coalesce(_payload->'training_progress','{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid training data';
  END IF;
  UPDATE public.experts SET
    jacket_issued = coalesce((_payload->>'jacket_issued')::boolean, false),
    jacket_issued_at = NULLIF(_payload->>'jacket_issued_at','')::date,
    joining_date = NULLIF(_payload->>'joining_date','')::date,
    training_progress = coalesce(_payload->'training_progress','{}'::jsonb)
  WHERE id = _expert_id;
  SELECT jsonb_build_object('jacket_issued', jacket_issued, 'jacket_issued_at', jacket_issued_at,
    'joining_date', joining_date, 'training_progress', training_progress)
    INTO _after FROM public.experts WHERE id = _expert_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'update_expert_onboarding', 'experts', _expert_id, _before, _after);
END $function$;

REVOKE EXECUTE ON FUNCTION public.staff_set_expert_onboarding(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_expert_onboarding(uuid, jsonb) TO authenticated, service_role;