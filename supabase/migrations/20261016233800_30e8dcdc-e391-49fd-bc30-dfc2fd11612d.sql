ALTER TABLE public.category_suggestions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'merchant';
GRANT SELECT ON public.category_suggestions TO cc_reader;
DROP POLICY IF EXISTS cc_reader_all ON public.category_suggestions;
CREATE POLICY cc_reader_all ON public.category_suggestions FOR SELECT TO cc_reader USING (true);

-- Backfill: old free-text labels on uncategorised items become pending "legacy" suggestions
INSERT INTO public.category_suggestions (merchant_id, product_id, service_type, suggested_name, source, created_at, updated_at)
SELECT p.merchant_id, p.id, coalesce(m.service_type,'store'), left(btrim(p.category_label), 40), 'legacy', p.created_at, now()
FROM public.products p JOIN public.merchants m ON m.id=p.merchant_id
LEFT JOIN public.catalog_categories c ON c.id=p.category_id
WHERE btrim(coalesce(p.category_label,'')) <> '' AND (p.category_id IS NULL OR c.is_other)
  AND NOT EXISTS (SELECT 1 FROM public.category_suggestions s WHERE s.product_id=p.id AND s.status='pending');

CREATE OR REPLACE FUNCTION public.cat_guess(_svc text, _label text) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, extensions AS $$
DECLARE l text := lower(btrim(coalesce(_label,''))); g text; r uuid;
BEGIN
  g := CASE
    WHEN l ~ 'temple|puja|pooja|agarbatti' THEN 'Puja Items'
    WHEN l ~ 'dispos|packag|container|cup|plate|bowl|cutlery|bag' THEN 'Packaging'
    WHEN l ~ 'kitchen|home|balcony|utensil' THEN 'Home & Kitchen'
    WHEN l ~ 'grocery|atta|rice|dal' THEN 'Atta, Rice & Dal'
    WHEN l ~ 'dairy|milk|bread|egg' THEN 'Dairy, Bread & Eggs'
    WHEN l ~ 'beverage|drink|juice' THEN 'Cold Drinks & Juices'
    WHEN l ~ 'book|stationer' THEN 'Stationery'
    WHEN l ~ 'namkeen|snack|upvas' THEN 'Snacks & Namkeen'
    WHEN l ~ 'hygiene|safety|clean' THEN 'Cleaning & Household'
    ELSE NULL END;
  IF g IS NOT NULL THEN
    SELECT id INTO r FROM catalog_categories WHERE service_type=_svc AND is_active AND city_id IS NULL AND name=g LIMIT 1;
  END IF;
  IF r IS NULL THEN
    SELECT id INTO r FROM catalog_categories WHERE service_type=_svc AND is_active AND city_id IS NULL AND NOT is_other
      AND extensions.similarity(lower(name), l) >= 0.35 ORDER BY extensions.similarity(lower(name), l) DESC LIMIT 1;
  END IF;
  IF r IS NULL THEN SELECT id INTO r FROM catalog_categories WHERE service_type=_svc AND is_other AND city_id IS NULL LIMIT 1; END IF;
  RETURN r;
END $$;

-- grouped list: one row per merchant + name
CREATE OR REPLACE FUNCTION public.staff_list_category_suggestions(_service text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE out jsonb;
BEGIN
  IF NOT is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  WITH g AS (
    SELECT (array_agg(s.id ORDER BY s.created_at))[1] id, s.merchant_id, min(s.suggested_name) label,
      count(DISTINCT s.product_id) items, max(s.updated_at) latest_at, bool_and(s.source='legacy') legacy, m.store_name, m.city_id
    FROM category_suggestions s JOIN merchants m ON m.id=s.merchant_id
    WHERE s.status='pending' AND s.service_type=_service
      AND (m.city_id IS NULL OR m.city_id = ANY (staff_allowed_city_ids()))
    GROUP BY s.merchant_id, lower(btrim(s.suggested_name)), m.store_name, m.city_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'merchant_id',merchant_id,'merchant',store_name,'label',label,'items',items,
    'latest_at',latest_at,'legacy',legacy,'city_id',city_id,'guess_id',cat_guess(_service,label),
    'guess_name',(SELECT name FROM catalog_categories WHERE id=cat_guess(_service,label))) ORDER BY latest_at DESC), '[]')
  INTO out FROM g;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.cat_push(_merchant uuid, _title text, _body text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM notify_merchant_push(_merchant, 'category_suggestion', _title, _body, '{}'::jsonb);
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.staff_resolve_category_suggestion(_id uuid, _mode text, _target_id uuid DEFAULT NULL,
  _name_en text DEFAULT NULL, _name_mr text DEFAULT NULL, _image_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s category_suggestions; t uuid; res jsonb; cname text; city uuid;
BEGIN
  IF NOT is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO s FROM category_suggestions WHERE id=_id AND status='pending';
  IF s.id IS NULL THEN RAISE EXCEPTION 'Suggestion is not pending'; END IF;
  IF _mode='create' THEN
    IF btrim(coalesce(_name_en,''))='' OR btrim(coalesce(_name_mr,''))='' THEN RAISE EXCEPTION 'English and मराठी names are required'; END IF;
    IF EXISTS (SELECT 1 FROM catalog_categories WHERE service_type=s.service_type AND lower(name)=lower(btrim(_name_en))) THEN
      RAISE EXCEPTION 'A category with this name already exists — use Map to existing';
    END IF;
    SELECT city_id INTO city FROM merchants WHERE id=s.merchant_id;
    INSERT INTO catalog_categories (service_type, name, name_mr, image_path, city_id, is_active, is_other, sort_order)
    VALUES (s.service_type, btrim(_name_en), btrim(_name_mr), nullif(_image_path,''), city, true, false,
      coalesce((SELECT max(sort_order) FROM catalog_categories WHERE service_type=s.service_type AND NOT is_other),0)+1)
    RETURNING id INTO t;
  ELSIF _mode='map' THEN
    IF NOT EXISTS (SELECT 1 FROM catalog_categories WHERE id=_target_id AND service_type=s.service_type) THEN RAISE EXCEPTION 'Pick a category'; END IF;
    t := _target_id;
  ELSE RAISE EXCEPTION 'Bad mode'; END IF;
  res := admin_decide_category_suggestion(_id, true, t, NULL, NULL);
  SELECT name INTO cname FROM catalog_categories WHERE id=t;
  PERFORM cat_push(s.merchant_id, 'Category updated', format('Your category ''%s'' is now ''%s''', s.suggested_name, cname));
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'category_suggestion_'||_mode, 'category_suggestions', _id, to_jsonb(s), res);
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.staff_reject_category_suggestion(_id uuid, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s category_suggestions; res jsonb;
BEGIN
  IF NOT is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF btrim(coalesce(_reason,''))='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  SELECT * INTO s FROM category_suggestions WHERE id=_id AND status='pending';
  IF s.id IS NULL THEN RAISE EXCEPTION 'Suggestion is not pending'; END IF;
  -- reject every pending row for the same merchant + name
  UPDATE category_suggestions SET status='rejected', reason=btrim(_reason), decided_by=auth.uid(), decided_at=now(), updated_at=now()
   WHERE status='pending' AND merchant_id=s.merchant_id AND lower(btrim(suggested_name))=lower(btrim(s.suggested_name)) AND id<>_id;
  res := admin_decide_category_suggestion(_id, false, NULL, NULL, _reason);
  PERFORM cat_push(s.merchant_id, 'Category suggestion not approved', format('''%s'' was not added: %s', s.suggested_name, btrim(_reason)));
  INSERT INTO audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'category_suggestion_reject', 'category_suggestions', _id, to_jsonb(s), jsonb_build_object('reason', _reason));
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.staff_apply_label_mapping(_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb; k int := 0; moved int := 0; res jsonb;
BEGIN
  IF NOT is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_rows,'[]'::jsonb)) LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM category_suggestions WHERE id=(r->>'id')::uuid AND status='pending');
    res := staff_resolve_category_suggestion((r->>'id')::uuid, 'map', (r->>'target_id')::uuid);
    k := k + 1; moved := moved + coalesce((res->>'moved')::int, 0);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'suggestions', k, 'moved', moved);
END $$;

REVOKE ALL ON FUNCTION public.cat_guess(text, text), public.cat_push(uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_list_category_suggestions(text), public.staff_resolve_category_suggestion(uuid, text, uuid, text, text, text),
  public.staff_reject_category_suggestion(uuid, text), public.staff_apply_label_mapping(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_list_category_suggestions(text), public.staff_resolve_category_suggestion(uuid, text, uuid, text, text, text),
  public.staff_reject_category_suggestion(uuid, text), public.staff_apply_label_mapping(jsonb) TO authenticated;