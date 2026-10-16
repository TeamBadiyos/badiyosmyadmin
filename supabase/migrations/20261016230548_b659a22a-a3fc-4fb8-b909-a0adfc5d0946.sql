DO $do$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.app_service_content(text,uuid)'::regprocedure);
  d := replace(d, $r$'card_title_mr', left($r$, $r$'cards_section_title', jsonb_build_object('en', left(coalesce(nullif(btrim(coalesce(h->>'cards_title','')),''),'What our experts do'),40), 'mr', left(coalesce(nullif(btrim(coalesce(h->>'cards_title_mr','')),''),'आमचे एक्सपर्ट काय करतात'),40)),
      'card_title_mr', left($r$);
  d := replace(d, $r$return case when _service_key = 'wash' then result - 'banner' - 'campaign' else result end;$r$,
    $r$if _service_key = 'clean' then result := result || jsonb_build_object('cards_section_title', result->'hero'->'cards_section_title'); end if;
  return case when _service_key = 'wash' then jsonb_set(result - 'banner' - 'campaign', '{hero}', (result->'hero') - 'cards_section_title') else result end;$r$);
  EXECUTE d;
END $do$;

CREATE OR REPLACE FUNCTION public.app_catalog_url(_p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT CASE WHEN nullif(_p,'') IS NULL THEN NULL WHEN _p ~* '^https?://' THEN _p
    ELSE 'https://api.badiyos.com/storage/v1/object/public/catalog-images/' || regexp_replace(regexp_replace(_p,'^/+',''),'^(catalog-images|product-images|merchant-documents)/','') END $$;

CREATE OR REPLACE FUNCTION public.app_store_is_open(_m uuid, _at timestamptz DEFAULT now()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH l AS (SELECT (_at AT TIME ZONE 'Asia/Kolkata') t)
  SELECT coalesce(m.is_open,true) AND coalesce(m.is_accepting_orders,true) AND coalesce(m.store_enabled,true)
    AND (m.busy_until IS NULL OR m.busy_until < _at)
    AND NOT EXISTS (SELECT 1 FROM merchant_schedule_overrides o, l WHERE o.merchant_id=m.id AND o.override_date=l.t::date AND o.is_closed)
    AND (NOT EXISTS (SELECT 1 FROM merchant_store_hours h WHERE h.merchant_id=m.id)
      OR EXISTS (SELECT 1 FROM merchant_store_hours h, l WHERE h.merchant_id=m.id AND h.day_of_week=extract(dow FROM l.t)::int AND NOT coalesce(h.is_closed,false)
        AND CASE WHEN h.close_time > h.open_time THEN l.t::time >= h.open_time AND l.t::time < h.close_time
                 ELSE l.t::time >= h.open_time OR l.t::time < h.close_time END))
  FROM merchants m WHERE m.id=_m $$;

CREATE OR REPLACE FUNCTION public.app_store_next_open(_m uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT min(((d::date + h.open_time) AT TIME ZONE 'Asia/Kolkata'))
  FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date + 7, interval '1 day') d
  JOIN merchant_store_hours h ON h.merchant_id=_m AND h.day_of_week=extract(dow FROM d)::int AND NOT coalesce(h.is_closed,false)
  WHERE ((d::date + h.open_time) AT TIME ZONE 'Asia/Kolkata') > now()
    AND NOT EXISTS (SELECT 1 FROM merchant_schedule_overrides o WHERE o.merchant_id=_m AND o.override_date=d::date AND o.is_closed) $$;

CREATE OR REPLACE FUNCTION public.app_store_card(_m uuid, _lat double precision, _lng double precision) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('id',m.id,'slug',m.store_slug,'name',m.store_name,'photo_url',app_catalog_url(m.shop_photo_url),
    'store_type', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'name_en',c.name,'name_mr',coalesce(c.name_mr,c.name)) END,
    'distance_km', CASE WHEN _lat IS NULL OR _lng IS NULL OR m.latitude IS NULL THEN NULL ELSE round((6371*2*asin(sqrt(power(sin(radians(m.latitude::float8-_lat)/2),2)+cos(radians(_lat))*cos(radians(m.latitude::float8))*power(sin(radians(m.longitude::float8-_lng)/2),2))))::numeric,1) END,
    'rating', CASE WHEN r.n >= 3 THEN round(r.a,1) END, 'rating_count', r.n,
    'is_open', app_store_is_open(m.id), 'next_open_at', CASE WHEN app_store_is_open(m.id) THEN NULL ELSE app_store_next_open(m.id) END,
    'offer_text', nullif(m.offer_text,''))
  FROM merchants m LEFT JOIN store_categories c ON c.id=m.store_category_id
  CROSS JOIN LATERAL (SELECT count(*)::int n, avg(rating)::numeric a FROM store_ratings WHERE store_id=m.id) r
  WHERE m.id=_m $$;

CREATE OR REPLACE FUNCTION public.app_store_live(_m uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM merchants WHERE id=_m AND deleted_at IS NULL AND status='approved' AND coalesce(store_enabled,true)) $$;

CREATE OR REPLACE FUNCTION public.app_item_card(_p uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'photo_url',app_catalog_url(coalesce(nullif(p.image_path,''),p.image_url)),
    'size',nullif(p.unit,''),'price',p.price,'original_price',NULL,'in_stock',coalesce(p.is_available,true),
    'variants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'price',v.price,'is_default',v.is_default) ORDER BY v.sort_order, v.price) FROM product_variants v WHERE v.product_id=p.id),'[]'),
    'addon_groups',coalesce((SELECT jsonb_agg(g ORDER BY g->>'name') FROM (
        SELECT jsonb_build_object('name',coalesce(a.group_name,'Add-ons'),'min',coalesce(min(a.min_select),0),'max',max(a.max_select),
          'options',jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'price',a.price) ORDER BY a.sort_order)) g
        FROM product_addons a WHERE a.product_id=p.id AND coalesce(a.is_active,true) GROUP BY coalesce(a.group_name,'Add-ons')) x),'[]'))
  FROM products p WHERE p.id=_p $$;

CREATE OR REPLACE FUNCTION public.app_item_live(_p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM products p WHERE p.id=_p AND p.approval_status='approved' AND coalesce(p.is_active,true) AND NOT coalesce(p.admin_hidden,false) AND app_store_live(p.merchant_id)) $$;

CREATE OR REPLACE FUNCTION public.app_commerce_home(_service_key text, _city_id uuid, _lat double precision DEFAULT NULL, _lng double precision DEFAULT NULL, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _svc text := CASE WHEN _service_key='food' THEN 'food' ELSE 'store' END; _cats jsonb; _rec uuid[]; _recj jsonb; _st jsonb;
BEGIN
  _cats := app_categories(CASE WHEN _svc='food' THEN 'food' ELSE 'store_type' END, _city_id);
  _cats := coalesce((SELECT jsonb_agg(jsonb_build_object('id',e->>'id','name_en',e->>'name','name_mr',e->>'name_mr',
      'icon_url',app_catalog_url(coalesce(nullif(e->>'image_path',''),e->>'icon_url')),'is_other',(e->>'is_other')::boolean,'sort',n) ORDER BY n)
    FROM jsonb_array_elements(_cats) WITH ORDINALITY t(e,n)),'[]');
  CREATE TEMP TABLE IF NOT EXISTS _ch(id uuid) ON COMMIT DROP; TRUNCATE _ch;
  INSERT INTO _ch SELECT m.id FROM merchants m
   WHERE m.deleted_at IS NULL AND m.status='approved' AND coalesce(m.store_enabled,true) AND coalesce(m.service_type,'store')=_svc
     AND (_city_id IS NULL OR m.city_id=_city_id)
     AND (_category_id IS NULL
       OR (_svc='store' AND (m.store_category_id=_category_id OR m.store_category_id IN (SELECT d.id FROM store_categories d JOIN store_categories c ON c.name=d.name WHERE c.id=_category_id)))
       OR (_svc='food' AND EXISTS (SELECT 1 FROM products p JOIN catalog_categories pc ON pc.id=p.category_id JOIN catalog_categories c ON c.id=_category_id
             WHERE p.merchant_id=m.id AND (pc.id=c.id OR pc.name=c.name) AND app_item_live(p.id))));
  SELECT array_agg(store_id ORDER BY pos) INTO _rec FROM (
    SELECT s.store_id, min(s.position) pos FROM sponsored_slots s
     WHERE s.is_active AND s.service_type=_svc AND s.store_id IN (SELECT id FROM _ch)
       AND (s.city_id IS NULL OR s.city_id=_city_id)
       AND (s.starts_at IS NULL OR s.starts_at<=now()) AND (s.ends_at IS NULL OR s.ends_at>now())
       AND CASE WHEN _category_id IS NULL THEN s.category_id IS NULL AND s.store_category_id IS NULL
                ELSE coalesce(s.store_category_id, s.category_id)=_category_id END
     GROUP BY s.store_id ORDER BY 2 LIMIT 6) x;
  _rec := coalesce(_rec, '{}');
  SELECT coalesce(jsonb_agg(app_store_card(id,_lat,_lng) ORDER BY array_position(_rec,id)),'[]') INTO _recj FROM unnest(_rec) id;
  SELECT coalesce(jsonb_agg(c ORDER BY (c->>'is_open')::boolean DESC, (c->>'distance_km')::numeric NULLS LAST, c->>'name'),'[]') INTO _st
    FROM (SELECT app_store_card(id,_lat,_lng) c FROM _ch WHERE id <> ALL(_rec)) z;
  RETURN jsonb_build_object('service_key',_svc,'city_id',_city_id,'category_id',_category_id,'categories',_cats,'recommended',_recj,'stores',_st);
END $$;

CREATE OR REPLACE FUNCTION public.app_store_page(_store_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m merchants; _card jsonb; _h record; _t timestamp := now() AT TIME ZONE 'Asia/Kolkata';
BEGIN
  IF NOT app_store_live(_store_id) THEN RETURN NULL; END IF;
  SELECT * INTO m FROM merchants WHERE id=_store_id;
  _card := app_store_card(_store_id, NULL, NULL);
  SELECT open_time, close_time INTO _h FROM merchant_store_hours WHERE merchant_id=_store_id AND day_of_week=extract(dow FROM _t)::int AND NOT coalesce(is_closed,false) LIMIT 1;
  RETURN jsonb_build_object(
    'store', (_card - 'distance_km') || jsonb_build_object('address',m.address,'opens_at',to_char(_h.open_time,'HH24:MI'),'closes_at',to_char(_h.close_time,'HH24:MI'),'service_type',coalesce(m.service_type,'store')),
    'recommended', coalesce((SELECT jsonb_agg(app_item_card(p.id) ORDER BY p.recommended_order NULLS LAST, p.sort_order) FROM (
        SELECT * FROM products p WHERE p.merchant_id=_store_id AND p.is_recommended AND app_item_live(p.id) ORDER BY p.recommended_order NULLS LAST, p.sort_order LIMIT 6) p),'[]'),
    'menu', coalesce((SELECT jsonb_agg(jsonb_build_object('category',jsonb_build_object('id',cid,'name_en',cn,'name_mr',cm),'items',items) ORDER BY oth, so, cn) FROM (
        SELECT c.id cid, coalesce(c.name,nullif(p.category_label,''),'Other') cn, coalesce(c.name_mr,c.name,nullif(p.category_label,''),'इतर') cm,
               coalesce(c.is_other, c.id IS NULL) oth, coalesce(c.sort_order,9999) so,
               jsonb_agg(app_item_card(p.id) ORDER BY p.sort_order NULLS LAST, p.name) items
        FROM products p LEFT JOIN catalog_categories c ON c.id=p.category_id
        WHERE p.merchant_id=_store_id AND app_item_live(p.id)
        GROUP BY 1,2,3,4,5) g),'[]'));
END $$;

CREATE OR REPLACE FUNCTION public.app_order_again(_service_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _svc text := CASE WHEN _service_key='food' THEN 'food' ELSE 'store' END; _u uuid := auth.uid();
BEGIN
  IF _u IS NULL THEN RETURN jsonb_build_object('stores','[]'::jsonb,'items','[]'::jsonb); END IF;
  RETURN jsonb_build_object(
    'stores', coalesce((SELECT jsonb_agg(app_store_card(mid,NULL,NULL) - 'distance_km' || jsonb_build_object('last_ordered_at',t) ORDER BY t DESC) FROM (
        SELECT o.merchant_id mid, max(o.created_at) t FROM merchant_orders o JOIN merchants m ON m.id=o.merchant_id
        WHERE o.user_id=_u AND (o.delivered_at IS NOT NULL OR o.status='delivered') AND coalesce(m.service_type,'store')=_svc AND app_store_live(o.merchant_id)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 3) s),'[]'),
    'items', coalesce((SELECT jsonb_agg(app_item_card(pid) || jsonb_build_object('store_id',mid,'store_name',sn,'last_ordered_at',t) ORDER BY t DESC) FROM (
        SELECT i.product_id pid, o.merchant_id mid, m.store_name sn, max(o.created_at) t FROM merchant_order_items i JOIN merchant_orders o ON o.id=i.order_id JOIN merchants m ON m.id=o.merchant_id
        WHERE o.user_id=_u AND (o.delivered_at IS NOT NULL OR o.status='delivered') AND coalesce(m.service_type,'store')=_svc AND i.product_id IS NOT NULL AND app_item_live(i.product_id)
        GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 3) s),'[]'));
END $$;

REVOKE ALL ON FUNCTION public.app_order_again(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_order_again(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_commerce_home(text,uuid,double precision,double precision,uuid), public.app_store_page(uuid), public.app_catalog_url(text) TO anon, authenticated;