CREATE OR REPLACE FUNCTION public.staff_delete_service_catalogue_row(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before jsonb;
  _mins integer;
  _blocking integer;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  SELECT to_jsonb(t), t.duration_minutes INTO _before, _mins
    FROM public.service_catalogue_config t WHERE t.id = _id;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'row_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.service_catalogue_config s
     WHERE s.id <> _id AND s.duration_minutes = _mins AND s.is_active = true
  ) THEN
    SELECT count(*) INTO _blocking FROM public.bookings b
      WHERE b.service_duration_minutes = _mins
        AND b.deleted_at IS NULL
        AND b.status NOT IN ('completed','cancelled','rejected');
    IF _blocking > 0 THEN
      RAISE EXCEPTION 'Cannot delete: % ongoing booking(s) still use this duration', _blocking;
    END IF;
  END IF;

  DELETE FROM public.service_catalogue_config WHERE id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state)
  VALUES (auth.uid(), 'delete_service_catalogue_row', 'service_catalogue_config', _id, _before);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_update_service_price(_id uuid, _payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before jsonb;
  _after jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  SELECT to_jsonb(s) INTO _before FROM public.service_catalogue_config s WHERE s.id = _id;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'row_not_found';
  END IF;

  UPDATE public.service_catalogue_config
     SET price = COALESCE((_payload->>'price')::numeric, price),
         expert_payout = CASE WHEN _payload ? 'expert_payout' THEN (_payload->>'expert_payout')::numeric ELSE expert_payout END,
         area_partner_payout = CASE WHEN _payload ? 'area_partner_payout' THEN (_payload->>'area_partner_payout')::numeric ELSE area_partner_payout END,
         hq_revenue = CASE WHEN _payload ? 'hq_revenue' THEN (_payload->>'hq_revenue')::numeric ELSE hq_revenue END,
         is_active = COALESCE((_payload->>'is_active')::boolean, is_active),
         duration_label = COALESCE(NULLIF(btrim(_payload->>'duration_label'), ''), duration_label),
         subtitle = CASE WHEN _payload ? 'subtitle' THEN NULLIF(btrim(_payload->>'subtitle'), '') ELSE subtitle END
   WHERE id = _id;

  SELECT to_jsonb(s) INTO _after FROM public.service_catalogue_config s WHERE s.id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'update_service_price', 'service_catalogue_config', _id, _before, _after);
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_delete_service_catalogue_row(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_service_price(uuid, jsonb) TO authenticated;