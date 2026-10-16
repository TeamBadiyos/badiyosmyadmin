-- wallet security follow-up
REVOKE ALL ON FUNCTION public.customer_wallets_mirror() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_transactions_redirect() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.users_coins_readonly() FROM public, anon, authenticated;

ALTER TABLE public.store_categories ADD COLUMN IF NOT EXISTS name_mr text, ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE, ADD COLUMN IF NOT EXISTS is_other boolean NOT NULL DEFAULT false;
ALTER TABLE public.catalog_categories ADD COLUMN IF NOT EXISTS name_mr text, ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES public.cities(id) ON DELETE CASCADE, ADD COLUMN IF NOT EXISTS is_other boolean NOT NULL DEFAULT false;

-- ---------- Store types ----------
DO $$
DECLARE seg uuid := (SELECT segment_id FROM store_categories LIMIT 1); _sw uuid; _food uuid;
  lst text[][] := ARRAY[
   ['Grocery','किराणा','kirana-grocery'],['Fruits & Vegetables','फळे व भाज्या','fruits-vegetables'],['Dairy & Bakery','दूध व बेकरी','dairy-milk'],
   ['Medical','मेडिकल','medical-pharmacy'],['Sweets & Namkeen','मिठाई व फरसाण','bakery-sweets'],['General Store','जनरल स्टोअर','general-store'],
   ['Stationery & Books','स्टेशनरी व पुस्तके','stationery-books'],['Puja Samagri','पूजा साहित्य','puja-samagri'],['Beauty & Cosmetics','सौंदर्य प्रसाधने','beauty-cosmetics'],
   ['Mobile & Electronics','मोबाईल व इलेक्ट्रॉनिक्स','electronics-mobile'],['Hardware & Electricals','हार्डवेअर व इलेक्ट्रिकल','hardware-electrical'],
   ['Gifts & Flowers','भेटवस्तू व फुले','gifts-flowers'],['Pet Supplies','पाळीव प्राणी साहित्य','pet-supplies'],['Packaging Material','पॅकेजिंग साहित्य','other'],
   ['Other','इतर','other-store']];
  i int;
BEGIN
  FOR i IN 1..array_length(lst,1) LOOP
    UPDATE store_categories SET name=lst[i][1], name_mr=lst[i][2], sort_order=i, rank=i, is_active=true, is_other=(lst[i][3]='other-store'), updated_at=now() WHERE slug=lst[i][3];
    IF NOT FOUND THEN
      INSERT INTO store_categories(segment_id,name,name_mr,slug,sort_order,rank,is_active,is_other) VALUES (seg,lst[i][1],lst[i][2],lst[i][3],i,i,true,lst[i][3]='other-store');
    END IF;
  END LOOP;
  SELECT id INTO _sw FROM store_categories WHERE slug='bakery-sweets';
  SELECT id INTO _food FROM store_categories WHERE slug='restaurant-food';
  IF _food IS NOT NULL THEN
    UPDATE merchants SET store_category_id=_sw WHERE store_category_id=_food;
    DELETE FROM store_categories WHERE id=_food;
  END IF;
  DELETE FROM store_categories WHERE slug='clothing-footwear' AND NOT EXISTS (SELECT 1 FROM merchants WHERE store_category_id=store_categories.id);
END $$;

-- ---------- Food + Store product categories ----------
DO $$
DECLARE i int; _id uuid;
  food text[][] := ARRAY[
   ['Thali','थाळी','Thali'],['Maharashtrian','महाराष्ट्रीयन',''],['North Indian','उत्तर भारतीय',''],['South Indian','दक्षिण भारतीय','South Indian'],
   ['Paneer Specials','पनीर स्पेशल',''],['Biryani & Pulao','बिर्याणी व पुलाव',''],['Chinese','चायनीज','Chinese'],['Pizza','पिझ्झा','Pizza & Burger'],
   ['Burger','बर्गर',''],['Sandwich & Rolls','सँडविच व रोल','Sandwich'],['Street Food','स्ट्रीट फूड',''],['Snacks','नाश्ता','Snacks'],
   ['Sweets','मिठाई','Sweets'],['Ice Cream','आईस्क्रीम','Ice Cream'],['Cakes & Bakery','केक व बेकरी',''],['Shakes & Juices','शेक व ज्यूस','Beverages'],
   ['Tea & Coffee','चहा व कॉफी',''],['Desserts','डेझर्ट्स',''],['Other','इतर','']];
  prod text[][] := ARRAY[
   ['Fruits & Vegetables','फळे व भाज्या'],['Dairy, Bread & Eggs','दूध, ब्रेड व अंडी'],['Atta, Rice & Dal','पीठ, तांदूळ व डाळ'],['Oil, Ghee & Masala','तेल, तूप व मसाले'],
   ['Snacks & Namkeen','स्नॅक्स व फरसाण'],['Biscuits & Bakery','बिस्किटे व बेकरी'],['Sweets & Chocolates','मिठाई व चॉकलेट'],['Tea, Coffee & Drinks','चहा, कॉफी व पेये'],
   ['Cold Drinks & Juices','शीतपेये व ज्यूस'],['Breakfast & Instant Food','नाश्ता व इन्स्टंट फूड'],['Dry Fruits','सुका मेवा'],['Sauces & Spreads','सॉस व स्प्रेड'],
   ['Personal Care','वैयक्तिक काळजी'],['Baby Care','बाळांची काळजी'],['Cleaning & Household','स्वच्छता व घरगुती'],['Home & Kitchen','घर व किचन'],
   ['Puja Items','पूजा साहित्य'],['Stationery','स्टेशनरी'],['Medicines & Health','औषधे व आरोग्य'],['Packaging','पॅकेजिंग'],['Pet Care','पाळीव प्राणी'],['Other','इतर']];
BEGIN
  FOR i IN 1..array_length(food,1) LOOP
    _id := NULL;
    IF food[i][3] <> '' THEN SELECT id INTO _id FROM catalog_categories WHERE service_type='food' AND city_id IS NULL AND name=food[i][3]; END IF;
    IF _id IS NULL THEN SELECT id INTO _id FROM catalog_categories WHERE service_type='food' AND city_id IS NULL AND name=food[i][1]; END IF;
    IF _id IS NULL THEN
      INSERT INTO catalog_categories(service_type,name,name_mr,sort_order,is_active,is_other) VALUES ('food',food[i][1],food[i][2],i,true,food[i][1]='Other');
    ELSE
      UPDATE catalog_categories SET name=food[i][1], name_mr=food[i][2], sort_order=i, is_active=true, is_other=(food[i][1]='Other') WHERE id=_id;
    END IF;
  END LOOP;
  FOR i IN 1..array_length(prod,1) LOOP
    IF NOT EXISTS (SELECT 1 FROM catalog_categories WHERE service_type='store' AND city_id IS NULL AND name=prod[i][1]) THEN
      INSERT INTO catalog_categories(service_type,name,name_mr,sort_order,is_active,is_other) VALUES ('store',prod[i][1],prod[i][2],i,true,prod[i][1]='Other');
    END IF;
  END LOOP;
  -- old "Food" store's items -> Snacks & Namkeen
  UPDATE products p SET category_id=(SELECT id FROM catalog_categories WHERE service_type='store' AND city_id IS NULL AND name='Snacks & Namkeen')
   WHERE p.category_id IS NULL AND p.merchant_id IN (SELECT id FROM merchants WHERE store_name='Amantran Little Bite');
END $$;

-- ---------- staff helpers ----------
CREATE OR REPLACE FUNCTION public.cat_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id=auth.uid() AND status='active' AND role='super_admin') $$;

-- kind: store_type | store_product | food
CREATE OR REPLACE FUNCTION public.staff_category_usage(_kind text, _id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN _kind='store_type' THEN (SELECT count(*) FROM merchants WHERE store_category_id=_id AND deleted_at IS NULL)
              ELSE (SELECT count(*) FROM products WHERE category_id=_id) END::int $$;

CREATE OR REPLACE FUNCTION public.staff_category_reorder(_kind text, _ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i int; _o uuid;
BEGIN
  IF NOT cat_is_admin() THEN RAISE EXCEPTION 'Only super admin'; END IF;
  FOR i IN 1..coalesce(array_length(_ids,1),0) LOOP
    IF _kind='store_type' THEN UPDATE store_categories SET sort_order=i, rank=i, updated_at=now() WHERE id=_ids[i] AND NOT is_other;
    ELSE UPDATE catalog_categories SET sort_order=i WHERE id=_ids[i] AND NOT is_other; END IF;
  END LOOP;
  IF _kind='store_type' THEN UPDATE store_categories SET sort_order=9999, rank=9999 WHERE is_other;
  ELSE UPDATE catalog_categories SET sort_order=9999 WHERE is_other; END IF;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'category_reorder',_kind,NULL,NULL,jsonb_build_object('ids',_ids));
END $$;

CREATE OR REPLACE FUNCTION public.staff_category_delete(_kind text, _id uuid, _move_to uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _before jsonb; _n int; _moved int := 0;
BEGIN
  IF NOT cat_is_admin() THEN RAISE EXCEPTION 'Only super admin'; END IF;
  IF _kind='store_type' THEN SELECT to_jsonb(c) INTO _before FROM store_categories c WHERE id=_id;
  ELSE SELECT to_jsonb(c) INTO _before FROM catalog_categories c WHERE id=_id; END IF;
  IF _before IS NULL THEN RAISE EXCEPTION 'Category not found'; END IF;
  IF (_before->>'is_other')::boolean THEN RAISE EXCEPTION '"Other" can''t be deleted'; END IF;
  IF _move_to IS NOT NULL THEN
    IF _move_to=_id THEN RAISE EXCEPTION 'Pick a different category'; END IF;
    IF _kind='store_type' THEN UPDATE merchants SET store_category_id=_move_to WHERE store_category_id=_id; GET DIAGNOSTICS _moved = ROW_COUNT;
    ELSE UPDATE products SET category_id=_move_to WHERE category_id=_id; GET DIAGNOSTICS _moved = ROW_COUNT; END IF;
  END IF;
  _n := staff_category_usage(_kind,_id);
  IF _kind='store_type' THEN _n := _n + (SELECT count(*) FROM merchants WHERE store_category_id=_id); END IF;
  IF _n > 0 THEN RAISE EXCEPTION 'Still used by % — move them to another category first', _n; END IF;
  IF _kind='store_type' THEN DELETE FROM store_categories WHERE id=_id; ELSE DELETE FROM catalog_categories WHERE id=_id; END IF;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES (auth.uid(),'category_delete',_kind,_id,_before,jsonb_build_object('moved',_moved,'move_to',_move_to));
  RETURN jsonb_build_object('ok',true,'moved',_moved);
END $$;

CREATE OR REPLACE FUNCTION public.staff_category_copy_default(_kind text, _city_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _n int;
BEGIN
  IF NOT cat_is_admin() THEN RAISE EXCEPTION 'Only super admin'; END IF;
  IF _kind='store_type' THEN
    IF EXISTS (SELECT 1 FROM store_categories WHERE city_id=_city_id) THEN RAISE EXCEPTION 'This city already has its own list'; END IF;
    INSERT INTO store_categories(segment_id,name,name_mr,slug,icon_url,rank,is_active,icon,sort_order,image_path,city_id,is_other)
    SELECT segment_id,name,name_mr,slug||'-'||left(_city_id::text,8),icon_url,rank,is_active,icon,sort_order,image_path,_city_id,is_other FROM store_categories WHERE city_id IS NULL;
  ELSE
    IF EXISTS (SELECT 1 FROM catalog_categories WHERE city_id=_city_id AND service_type=CASE WHEN _kind='food' THEN 'food' ELSE 'store' END) THEN RAISE EXCEPTION 'This city already has its own list'; END IF;
    INSERT INTO catalog_categories(service_type,name,name_mr,image_path,sort_order,is_active,city_id,is_other)
    SELECT service_type,name,name_mr,image_path,sort_order,is_active,_city_id,is_other FROM catalog_categories
     WHERE city_id IS NULL AND service_type=CASE WHEN _kind='food' THEN 'food' ELSE 'store' END;
  END IF;
  GET DIAGNOSTICS _n = ROW_COUNT;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state) VALUES (auth.uid(),'category_copy_default',_kind,_city_id,NULL,jsonb_build_object('rows',_n));
  RETURN _n;
END $$;

-- apply product-category mapping: [{label, category_id}]
CREATE OR REPLACE FUNCTION public.staff_apply_product_category_map(_map jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e jsonb; _n int := 0; _k int;
BEGIN
  IF NOT cat_is_admin() THEN RAISE EXCEPTION 'Only super admin'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(_map) LOOP
    UPDATE products p SET category_id=(e->>'category_id')::uuid
     WHERE p.category_id IS NULL AND coalesce(p.category_label,'')=coalesce(e->>'label','')
       AND p.merchant_id IN (SELECT id FROM merchants WHERE service_type='store');
    GET DIAGNOSTICS _k = ROW_COUNT; _n := _n + _k;
  END LOOP;
  INSERT INTO audit_logs(actor_id,action,target_table,target_id,before_state,after_state) VALUES (auth.uid(),'product_category_map','products',NULL,NULL,jsonb_build_object('map',_map,'updated',_n));
  RETURN _n;
END $$;

-- ---------- public ----------
CREATE OR REPLACE FUNCTION public.app_categories(_kind text, _city_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _svc text := CASE WHEN _kind='food' THEN 'food' ELSE 'store' END; _use_city boolean;
BEGIN
  IF _kind='store_type' THEN
    _use_city := _city_id IS NOT NULL AND EXISTS (SELECT 1 FROM store_categories WHERE city_id=_city_id);
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'name_mr',coalesce(c.name_mr,c.name),'image_path',c.image_path,'icon_url',c.icon_url,'is_other',c.is_other) ORDER BY c.is_other, c.sort_order)
      FROM store_categories c WHERE c.is_active AND (CASE WHEN _use_city THEN c.city_id=_city_id ELSE c.city_id IS NULL END)
        AND EXISTS (SELECT 1 FROM merchants m WHERE m.deleted_at IS NULL AND m.status='approved' AND m.service_type='store'
              AND (_city_id IS NULL OR m.city_id=_city_id)
              AND (m.store_category_id=c.id OR m.store_category_id IN (SELECT d.id FROM store_categories d WHERE d.slug=c.slug OR c.slug LIKE d.slug||'-%')))),'[]'::jsonb);
  END IF;
  _use_city := _city_id IS NOT NULL AND EXISTS (SELECT 1 FROM catalog_categories WHERE city_id=_city_id AND service_type=_svc);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'name_mr',coalesce(c.name_mr,c.name),'image_path',c.image_path,'is_other',c.is_other) ORDER BY c.is_other, c.sort_order)
    FROM catalog_categories c WHERE c.is_active AND c.service_type=_svc AND (CASE WHEN _use_city THEN c.city_id=_city_id ELSE c.city_id IS NULL END)
      AND EXISTS (SELECT 1 FROM products p JOIN merchants m ON m.id=p.merchant_id
            JOIN catalog_categories pc ON pc.id=p.category_id
            WHERE (pc.id=c.id OR (pc.name=c.name AND pc.service_type=c.service_type))
              AND p.approval_status='approved' AND coalesce(p.is_available,true) AND coalesce(p.is_active,true) AND NOT coalesce(p.admin_hidden,false)
              AND m.deleted_at IS NULL AND m.status='approved' AND (_city_id IS NULL OR m.city_id=_city_id))),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.cat_is_admin() FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_category_usage(text,uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_category_reorder(text,uuid[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_category_delete(text,uuid,uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_category_copy_default(text,uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.staff_apply_product_category_map(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_categories(text,uuid) TO anon, authenticated;