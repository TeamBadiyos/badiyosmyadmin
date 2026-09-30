ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS query_notes text,
  ADD COLUMN IF NOT EXISTS query_doc_types text[],
  ADD COLUMN IF NOT EXISTS queried_at timestamptz,
  ADD COLUMN IF NOT EXISTS queried_by uuid,
  ADD COLUMN IF NOT EXISTS awaiting_reupload boolean NOT NULL DEFAULT false;

-- Reject now stores a mandatory reason; approve clears any open query.
CREATE OR REPLACE FUNCTION public.staff_decide_merchant(_merchant_id uuid, _decision text, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF _decision = 'rejected' AND (_notes IS NULL OR btrim(_notes) = '') THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  SELECT id INTO _staff_id FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active';

  SELECT to_jsonb(m) INTO _before FROM public.merchants m WHERE id = _merchant_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'merchant_not_found'; END IF;

  UPDATE public.merchants
     SET status = _decision,
         approved_by = _staff_id,
         approved_at = now(),
         rejection_reason = CASE WHEN _decision = 'rejected' THEN btrim(_notes) ELSE NULL END,
         query_notes = NULL,
         query_doc_types = NULL,
         queried_at = NULL,
         queried_by = NULL,
         awaiting_reupload = false,
         updated_at = now()
   WHERE id = _merchant_id;

  SELECT to_jsonb(m) INTO _after FROM public.merchants m WHERE id = _merchant_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_' || _decision, 'merchants', _merchant_id, _before,
          _after || jsonb_build_object('decision_notes', _notes));

  -- Tell the store owner what happened.
  BEGIN
    IF _decision = 'rejected' THEN
      PERFORM public.notify_push_event(
        'merchant',
        (SELECT auth_user_id FROM public.merchants WHERE id = _merchant_id),
        'merchant_rejected',
        'Store application rejected',
        btrim(_notes),
        jsonb_build_object('route', '/onboarding', 'merchant_id', _merchant_id)
      );
    ELSE
      PERFORM public.notify_push_event(
        'merchant',
        (SELECT auth_user_id FROM public.merchants WHERE id = _merchant_id),
        'merchant_approved',
        'Store approved',
        'Your store is live on Badiyos. You can start taking orders.',
        jsonb_build_object('route', '/home', 'merchant_id', _merchant_id)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[staff_decide_merchant] notify failed for %: %', _merchant_id, SQLERRM;
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_decide_merchant(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decide_merchant(uuid, text, text) TO authenticated, service_role;

-- Raise a document query: ask the merchant to re-upload specific documents.
CREATE OR REPLACE FUNCTION public.staff_merchant_raise_query(
  _merchant_id uuid,
  _doc_types text[],
  _notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _before jsonb;
  _after jsonb;
  _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  IF _notes IS NULL OR btrim(_notes) = '' THEN
    RAISE EXCEPTION 'query_notes_required';
  END IF;
  IF _doc_types IS NULL OR array_length(_doc_types, 1) IS NULL THEN
    RAISE EXCEPTION 'select_at_least_one_document';
  END IF;

  SELECT to_jsonb(m), m.auth_user_id INTO _before, _owner
    FROM public.merchants m WHERE m.id = _merchant_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'merchant_not_found'; END IF;

  UPDATE public.merchants
     SET status = 'draft',
         query_notes = btrim(_notes),
         query_doc_types = _doc_types,
         queried_at = now(),
         queried_by = _uid,
         awaiting_reupload = true,
         rejection_reason = NULL,
         updated_at = now()
   WHERE id = _merchant_id;

  SELECT to_jsonb(m) INTO _after FROM public.merchants m WHERE m.id = _merchant_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'merchant_query_raised', 'merchants', _merchant_id, _before, _after);

  BEGIN
    PERFORM public.notify_push_event(
      'merchant',
      _owner,
      'merchant_document_query',
      'Action needed: re-upload documents',
      btrim(_notes),
      jsonb_build_object(
        'route', '/onboarding',
        'merchant_id', _merchant_id,
        'doc_types', to_jsonb(_doc_types)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[staff_merchant_raise_query] notify failed for %: %', _merchant_id, SQLERRM;
  END;
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_merchant_raise_query(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_merchant_raise_query(uuid, text[], text) TO authenticated, service_role;