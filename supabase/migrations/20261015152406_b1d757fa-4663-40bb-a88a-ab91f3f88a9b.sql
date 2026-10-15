CREATE OR REPLACE FUNCTION public.merchant_ensure_draft(_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_digits text := regexp_replace(coalesce(_phone,''), '\D', '', 'g');
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_id FROM public.merchants WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF v_digits !~ '^[6-9][0-9]{9}$' THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
  UPDATE public.merchants SET auth_user_id = v_uid, updated_at = now()
   WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = v_digits
     AND auth_user_id IS NULL AND deleted_at IS NULL
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.merchants (auth_user_id, phone, status, onboarding_step)
  VALUES (v_uid, v_digits, 'draft', 1) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Staff: delete a rejected store and free the merchant login so they restart onboarding from step 1
CREATE OR REPLACE FUNCTION public.staff_delete_rejected_merchant(_merchant_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m public.merchants%ROWTYPE;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Only super admin or ops manager can delete a store';
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_m FROM public.merchants WHERE id = _merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_m.status <> 'rejected' THEN RAISE EXCEPTION 'Only rejected stores can be deleted here'; END IF;
  IF v_m.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Store already deleted'; END IF;
  UPDATE public.merchants SET deleted_at = now(), delete_reason = trim(_reason),
    auth_user_id = NULL, is_accepting_orders = false, updated_at = now()
   WHERE id = _merchant_id;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'merchant.delete_rejected', 'merchants', _merchant_id,
    jsonb_build_object('status', v_m.status, 'auth_user_id', v_m.auth_user_id),
    jsonb_build_object('reason', trim(_reason)));
END $$;
REVOKE ALL ON FUNCTION public.staff_delete_rejected_merchant(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_delete_rejected_merchant(uuid, text) TO authenticated;

-- Merchant self-serve: restart a rejected application from step 1
CREATE OR REPLACE FUNCTION public.merchant_restart_application()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.merchants SET status = 'draft', onboarding_step = 1, updated_at = now()
   WHERE auth_user_id = auth.uid() AND deleted_at IS NULL AND status = 'rejected';
  IF NOT FOUND THEN RAISE EXCEPTION 'No rejected application to restart'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.merchant_restart_application() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merchant_restart_application() TO authenticated;