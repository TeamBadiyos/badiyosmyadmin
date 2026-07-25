
-- Service catalogue: super admin only price update
CREATE OR REPLACE FUNCTION public.staff_update_service_price(_id uuid, _payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _before jsonb;
  _after jsonb;
  _price numeric;
  _expert numeric;
  _partner numeric;
  _hq numeric;
  _active boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role <> 'super_admin' THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT to_jsonb(s) INTO _before FROM public.service_catalogue_config s WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Row not found'; END IF;

  _price   := NULLIF(_payload->>'price','')::numeric;
  _expert  := NULLIF(_payload->>'expert_payout','')::numeric;
  _partner := NULLIF(_payload->>'area_partner_payout','')::numeric;
  _hq      := NULLIF(_payload->>'hq_revenue','')::numeric;
  _active  := COALESCE((_payload->>'is_active')::boolean, (_before->>'is_active')::boolean);

  IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;
  IF _expert IS NOT NULL AND _expert < 0 THEN RAISE EXCEPTION 'Invalid expert payout'; END IF;
  IF _partner IS NOT NULL AND _partner < 0 THEN RAISE EXCEPTION 'Invalid partner payout'; END IF;
  IF _hq IS NOT NULL AND _hq < 0 THEN RAISE EXCEPTION 'Invalid HQ share'; END IF;

  UPDATE public.service_catalogue_config
     SET price = _price,
         expert_payout = _expert,
         area_partner_payout = _partner,
         hq_revenue = _hq,
         is_active = _active
   WHERE id = _id;

  SELECT to_jsonb(s) INTO _after FROM public.service_catalogue_config s WHERE id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'update_service_price', 'service_catalogue_config', _id, _before, _after);
END;$$;

REVOKE ALL ON FUNCTION public.staff_update_service_price(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.staff_update_service_price(uuid, jsonb) TO authenticated;

-- Homepage sections: upsert
CREATE OR REPLACE FUNCTION public.staff_upsert_homepage_section(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _id uuid;
  _section_type text;
  _display_order int;
  _is_active boolean;
  _body jsonb;
  _city uuid;
  _before jsonb;
  _after jsonb;
  _next_order int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  _id := NULLIF(_payload->>'id','')::uuid;
  _section_type := _payload->>'section_type';
  _display_order := NULLIF(_payload->>'display_order','')::int;
  _is_active := COALESCE((_payload->>'is_active')::boolean, true);
  _body := COALESCE(_payload->'payload', '{}'::jsonb);
  _city := NULLIF(_payload->>'city_id','')::uuid;

  IF _section_type IS NULL OR length(btrim(_section_type)) = 0 THEN
    RAISE EXCEPTION 'section_type required';
  END IF;

  IF _id IS NULL THEN
    IF _display_order IS NULL THEN
      SELECT COALESCE(MAX(display_order), -1) + 1 INTO _next_order
        FROM public.homepage_sections WHERE section_type = _section_type;
      _display_order := _next_order;
    END IF;
    INSERT INTO public.homepage_sections
      (section_type, display_order, is_active, payload, city_id, updated_by, updated_at)
    VALUES (_section_type, _display_order, _is_active, _body, _city, _uid, now())
    RETURNING section_id INTO _id;

    SELECT to_jsonb(h) INTO _after FROM public.homepage_sections h WHERE section_id = _id;
    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'create_homepage_section', 'homepage_sections', _id, NULL, _after);
  ELSE
    SELECT to_jsonb(h) INTO _before FROM public.homepage_sections h WHERE section_id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION 'Section not found'; END IF;
    UPDATE public.homepage_sections
       SET section_type = _section_type,
           display_order = COALESCE(_display_order, display_order),
           is_active = _is_active,
           payload = _body,
           city_id = _city,
           updated_by = _uid,
           updated_at = now()
     WHERE section_id = _id;
    SELECT to_jsonb(h) INTO _after FROM public.homepage_sections h WHERE section_id = _id;
    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'update_homepage_section', 'homepage_sections', _id, _before, _after);
  END IF;

  RETURN _id;
END;$$;

REVOKE ALL ON FUNCTION public.staff_upsert_homepage_section(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.staff_upsert_homepage_section(jsonb) TO authenticated;

-- Homepage sections: active toggle
CREATE OR REPLACE FUNCTION public.staff_set_homepage_section_active(_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT to_jsonb(h) INTO _before FROM public.homepage_sections h WHERE section_id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Section not found'; END IF;

  UPDATE public.homepage_sections
     SET is_active = _active, updated_by = _uid, updated_at = now()
   WHERE section_id = _id;

  SELECT to_jsonb(h) INTO _after FROM public.homepage_sections h WHERE section_id = _id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'toggle_homepage_section', 'homepage_sections', _id, _before, _after);
END;$$;

REVOKE ALL ON FUNCTION public.staff_set_homepage_section_active(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.staff_set_homepage_section_active(uuid, boolean) TO authenticated;

-- Homepage sections: reorder within a section_type
CREATE OR REPLACE FUNCTION public.staff_reorder_homepage_sections(_orders jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _item jsonb;
  _ids uuid[];
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF _orders IS NULL OR jsonb_typeof(_orders) <> 'array' THEN
    RAISE EXCEPTION 'Invalid input';
  END IF;

  SELECT array_agg((e->>'id')::uuid) INTO _ids FROM jsonb_array_elements(_orders) e;
  SELECT jsonb_agg(to_jsonb(h)) INTO _before FROM public.homepage_sections h WHERE section_id = ANY(_ids);

  FOR _item IN SELECT * FROM jsonb_array_elements(_orders) LOOP
    UPDATE public.homepage_sections
       SET display_order = (_item->>'display_order')::int,
           updated_by = _uid,
           updated_at = now()
     WHERE section_id = (_item->>'id')::uuid;
  END LOOP;

  SELECT jsonb_agg(to_jsonb(h)) INTO _after FROM public.homepage_sections h WHERE section_id = ANY(_ids);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'reorder_homepage_sections', 'homepage_sections', NULL, _before, _after);
END;$$;

REVOKE ALL ON FUNCTION public.staff_reorder_homepage_sections(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.staff_reorder_homepage_sections(jsonb) TO authenticated;
