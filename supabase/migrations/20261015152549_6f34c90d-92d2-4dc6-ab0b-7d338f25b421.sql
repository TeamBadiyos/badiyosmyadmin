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
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'merchant.delete_rejected', 'merchants', _merchant_id,
    jsonb_build_object('status', v_m.status, 'auth_user_id', v_m.auth_user_id),
    jsonb_build_object('reason', trim(_reason)));
END $$;