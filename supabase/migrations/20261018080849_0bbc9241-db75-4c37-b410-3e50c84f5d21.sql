CREATE OR REPLACE FUNCTION public.app_categories(_kind text, _city_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _svc text := CASE WHEN _kind='food' THEN 'food' ELSE 'store' END; _use_city boolean;
BEGIN
  IF _kind='store_type' THEN
    _use_city := _city_id IS NOT NULL AND EXISTS (SELECT 1 FROM store_categories WHERE city_id=_city_id);
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'name_mr',coalesce(c.name_mr,c.name),'image_path',c.image_path,'icon_url',c.icon_url,'icon',c.icon,'is_other',c.is_other) ORDER BY c.is_other, c.sort_order)
      FROM store_categories c WHERE c.is_active AND (CASE WHEN _use_city THEN c.city_id=_city_id ELSE c.city_id IS NULL END)
        AND EXISTS (SELECT 1 FROM merchants m WHERE m.deleted_at IS NULL AND m.status='approved' AND m.service_type='store'
              AND (_city_id IS NULL OR m.city_id=_city_id)
              AND (m.store_category_id=c.id OR m.store_category_id IN (SELECT d.id FROM store_categories d WHERE d.slug=c.slug OR c.slug LIKE d.slug||'-%')))),'[]'::jsonb);
  END IF;
  _use_city := _city_id IS NOT NULL AND EXISTS (SELECT 1 FROM catalog_categories WHERE city_id=_city_id AND service_type=_svc);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'name_mr',coalesce(c.name_mr,c.name),'image_path',c.image_path,'icon',c.icon,'is_other',c.is_other) ORDER BY c.is_other, c.sort_order)
    FROM catalog_categories c WHERE c.is_active AND c.service_type=_svc AND (CASE WHEN _use_city THEN c.city_id=_city_id ELSE c.city_id IS NULL END)
      AND EXISTS (SELECT 1 FROM products p JOIN merchants m ON m.id=p.merchant_id
            JOIN catalog_categories pc ON pc.id=p.category_id
            WHERE (pc.id=c.id OR (pc.name=c.name AND pc.service_type=c.service_type))
              AND p.approval_status='approved' AND coalesce(p.is_available,true) AND coalesce(p.is_active,true) AND NOT coalesce(p.admin_hidden,false)
              AND m.deleted_at IS NULL AND m.status='approved' AND (_city_id IS NULL OR m.city_id=_city_id))),'[]'::jsonb);
END $$;
GRANT EXECUTE ON FUNCTION public.app_categories(text,uuid) TO anon, authenticated;