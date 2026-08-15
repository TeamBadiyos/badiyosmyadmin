CREATE OR REPLACE FUNCTION public.staff_set_merchant_fee_tier(_merchant_id uuid, _fee_tier_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT jsonb_build_object('fee_tier_id', fee_tier_id) INTO _before FROM public.merchants WHERE id=_merchant_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Merchant not found'; END IF;
  IF _fee_tier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.merchant_fee_tiers WHERE id=_fee_tier_id AND is_active) THEN
    RAISE EXCEPTION 'Fee tier not found or inactive';
  END IF;
  UPDATE public.merchants SET fee_tier_id=_fee_tier_id, updated_at=now() WHERE id=_merchant_id;
  _after := jsonb_build_object('fee_tier_id', _fee_tier_id);
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'set_merchant_fee_tier','merchants',_merchant_id,_before,_after);
END $$;

CREATE OR REPLACE FUNCTION public.staff_upsert_fee_tier(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _id uuid := NULLIF(_payload->>'id','')::uuid; _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.merchant_fee_tiers(name, monthly_fee, is_active)
      VALUES(_payload->>'name', (_payload->>'monthly_fee')::numeric, COALESCE((_payload->>'is_active')::boolean, true))
      RETURNING id INTO _id;
  ELSE
    SELECT to_jsonb(t) INTO _before FROM public.merchant_fee_tiers t WHERE id=_id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Fee tier not found'; END IF;
    UPDATE public.merchant_fee_tiers
       SET name = COALESCE(_payload->>'name', name),
           monthly_fee = COALESCE((_payload->>'monthly_fee')::numeric, monthly_fee),
           is_active = COALESCE((_payload->>'is_active')::boolean, is_active)
     WHERE id=_id;
  END IF;
  SELECT to_jsonb(t) INTO _after FROM public.merchant_fee_tiers t WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'upsert_fee_tier','merchant_fee_tiers',_id,_before,_after);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_generate_subscription_invoices()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _month date; _created int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  _month := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;

  WITH ins AS (
    INSERT INTO public.merchant_subscription_invoices(merchant_id, fee_tier_id, billing_month, amount, status)
    SELECT m.id, m.fee_tier_id, _month, t.monthly_fee, 'pending'
      FROM public.merchants m
      JOIN public.merchant_fee_tiers t ON t.id = m.fee_tier_id
     WHERE m.status = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM public.merchant_subscription_invoices i
          WHERE i.merchant_id = m.id AND i.billing_month = _month
       )
    RETURNING 1
  ) SELECT count(*) INTO _created FROM ins;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'generate_subscription_invoices','merchant_subscription_invoices',NULL,NULL,
           jsonb_build_object('billing_month',_month,'created',_created));
  RETURN jsonb_build_object('billing_month', _month, 'created', _created);
END $$;

CREATE OR REPLACE FUNCTION public.staff_mark_subscription_invoice_paid(_invoice_id uuid, _paid boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(i) INTO _before FROM public.merchant_subscription_invoices i WHERE id=_invoice_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  UPDATE public.merchant_subscription_invoices
     SET status = CASE WHEN _paid THEN 'paid' ELSE 'pending' END,
         paid_at = CASE WHEN _paid THEN now() ELSE NULL END
   WHERE id=_invoice_id;
  SELECT to_jsonb(i) INTO _after FROM public.merchant_subscription_invoices i WHERE id=_invoice_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'mark_subscription_invoice_paid','merchant_subscription_invoices',_invoice_id,_before,_after);
END $$;

REVOKE ALL ON FUNCTION public.staff_set_merchant_fee_tier(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_upsert_fee_tier(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_generate_subscription_invoices() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_mark_subscription_invoice_paid(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_merchant_fee_tier(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_upsert_fee_tier(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_generate_subscription_invoices() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_mark_subscription_invoice_paid(uuid, boolean) TO authenticated, service_role;