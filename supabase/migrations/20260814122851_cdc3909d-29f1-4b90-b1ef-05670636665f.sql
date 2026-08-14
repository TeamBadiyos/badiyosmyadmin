-- 1. Ensure a Home Cleaning service category exists under the Clean segment
INSERT INTO public.service_categories (segment_id, name, slug, rank, is_active)
SELECT s.id, 'Home Cleaning', 'home-cleaning', 0, true
FROM public.segments s
WHERE s.slug = 'clean'
  AND NOT EXISTS (SELECT 1 FROM public.service_categories sc WHERE sc.slug = 'home-cleaning');

-- 2. Link catalogue rows to a service category
ALTER TABLE public.service_catalogue_config
  ADD COLUMN IF NOT EXISTS service_category_id uuid REFERENCES public.service_categories(id);

UPDATE public.service_catalogue_config
SET service_category_id = (SELECT id FROM public.service_categories WHERE slug = 'home-cleaning')
WHERE service_category_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_catalogue_config_category
  ON public.service_catalogue_config (service_category_id);

-- 3. Create row RPC
CREATE OR REPLACE FUNCTION public.staff_create_service_catalogue_row(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_id uuid;
  _cat uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  _cat := NULLIF(_payload->>'service_category_id','')::uuid;
  IF _cat IS NULL THEN
    SELECT id INTO _cat FROM public.service_categories WHERE slug = 'home-cleaning';
  END IF;
  IF _cat IS NULL THEN
    RAISE EXCEPTION 'service_category_id required';
  END IF;

  IF COALESCE(_payload->>'duration_label','') = '' THEN
    RAISE EXCEPTION 'duration_label required';
  END IF;
  IF COALESCE((_payload->>'duration_minutes')::int, 0) <= 0 THEN
    RAISE EXCEPTION 'duration_minutes must be positive';
  END IF;
  IF COALESCE((_payload->>'price')::numeric, -1) < 0 THEN
    RAISE EXCEPTION 'price must be non-negative';
  END IF;

  INSERT INTO public.service_catalogue_config (
    duration_label, duration_minutes, subtitle, price,
    expert_payout, area_partner_payout, hq_revenue,
    icon, display_order, is_active, service_category_id
  ) VALUES (
    _payload->>'duration_label',
    (_payload->>'duration_minutes')::int,
    NULLIF(_payload->>'subtitle',''),
    (_payload->>'price')::numeric,
    NULLIF(_payload->>'expert_payout','')::numeric,
    NULLIF(_payload->>'area_partner_payout','')::numeric,
    NULLIF(_payload->>'hq_revenue','')::numeric,
    NULLIF(_payload->>'icon',''),
    COALESCE(NULLIF(_payload->>'display_order','')::int,
             (SELECT COALESCE(MAX(display_order),0)+1 FROM public.service_catalogue_config WHERE service_category_id = _cat)),
    COALESCE((_payload->>'is_active')::boolean, true),
    _cat
  )
  RETURNING id INTO _new_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
  VALUES (auth.uid(), 'create_service_catalogue_row', 'service_catalogue_config', _new_id, _payload);

  RETURN _new_id;
END;
$$;

-- 4. Delete (soft-delete) row RPC
CREATE OR REPLACE FUNCTION public.staff_delete_service_catalogue_row(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _before jsonb;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT to_jsonb(t) INTO _before FROM public.service_catalogue_config t WHERE t.id = _id;
  IF _before IS NULL THEN
    RAISE EXCEPTION 'Row not found';
  END IF;

  UPDATE public.service_catalogue_config SET is_active = false WHERE id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state)
  VALUES (auth.uid(), 'delete_service_catalogue_row', 'service_catalogue_config', _id, _before);
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_create_service_catalogue_row(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_delete_service_catalogue_row(uuid) TO authenticated;