ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE OR REPLACE FUNCTION public.staff_soft_delete_merchant(_merchant_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _staff record;
  _before record;
  _open_store_orders int;
  _open_business_orders int;
BEGIN
  SELECT role, status INTO _staff FROM public.staff_users
  WHERE auth_user_id = auth.uid();
  IF _staff IS NULL OR _staff.status <> 'active' OR _staff.role <> 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can delete a merchant store';
  END IF;

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a store';
  END IF;

  SELECT * INTO _before FROM public.merchants WHERE id = _merchant_id;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Merchant not found';
  END IF;
  IF _before.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This store is already deleted';
  END IF;

  SELECT count(*) INTO _open_store_orders FROM public.merchant_orders
  WHERE merchant_id = _merchant_id
    AND status IN ('placed','accepted','preparing','ready','rider_assigned','picked_up','on_the_way');
  SELECT count(*) INTO _open_business_orders FROM public.business_orders
  WHERE merchant_id = _merchant_id
    AND status IN ('pending','planned','dispatched','in_transit');
  IF _open_store_orders + _open_business_orders > 0 THEN
    RAISE EXCEPTION 'This store has % open order(s). Resolve or cancel them before deleting.', _open_store_orders + _open_business_orders;
  END IF;

  UPDATE public.merchants
  SET deleted_at = now(),
      delete_reason = btrim(_reason),
      is_accepting_orders = false,
      store_enabled = false,
      delivery_enabled = false,
      updated_at = now()
  WHERE id = _merchant_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (
    auth.uid(),
    'soft_delete_merchant',
    'merchants',
    _merchant_id,
    to_jsonb(_before),
    (SELECT to_jsonb(m) FROM public.merchants m WHERE m.id = _merchant_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_soft_delete_merchant(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_soft_delete_merchant(uuid, text) TO authenticated;