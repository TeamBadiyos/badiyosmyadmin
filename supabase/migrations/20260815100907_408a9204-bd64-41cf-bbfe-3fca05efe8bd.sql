CREATE OR REPLACE FUNCTION public.staff_decide_merchant(_merchant_id uuid, _decision text, _notes text DEFAULT NULL)
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
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;

  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';

  SELECT to_jsonb(m) INTO _before FROM public.merchants m WHERE id = _merchant_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'merchant_not_found'; END IF;

  UPDATE public.merchants
     SET status = _decision,
         approved_by = _staff_id,
         approved_at = now(),
         updated_at = now()
   WHERE id = _merchant_id;

  SELECT to_jsonb(m) INTO _after FROM public.merchants m WHERE id = _merchant_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_' || _decision, 'merchants', _merchant_id, _before,
          _after || jsonb_build_object('decision_notes', _notes));
END $function$;

REVOKE EXECUTE ON FUNCTION public.staff_decide_merchant(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decide_merchant(uuid, text, text) TO authenticated, service_role;