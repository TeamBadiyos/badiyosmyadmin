
-- 1 & 5. merchants extension
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS commission_pct numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS instant_settlement_fee_pct numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accept_timeout_minutes integer,
  ADD COLUMN IF NOT EXISTS offer_text text,
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_service_type_check;
ALTER TABLE public.merchants ADD CONSTRAINT merchants_service_type_check CHECK (service_type IN ('store','food'));
CREATE INDEX IF NOT EXISTS idx_merchants_service_type ON public.merchants(service_type, is_open);

-- 2. categories
CREATE TABLE IF NOT EXISTS public.catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL CHECK (service_type IN ('store','food')),
  name text NOT NULL,
  image_path text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.catalog_categories TO anon, authenticated;
GRANT ALL ON public.catalog_categories TO service_role;
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cc_read_active" ON public.catalog_categories FOR SELECT TO anon, authenticated USING (is_active OR public.is_super_admin_user());
CREATE INDEX IF NOT EXISTS idx_catalog_categories_svc ON public.catalog_categories(service_type, is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.store_category_order (
  store_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.catalog_categories(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, category_id)
);
GRANT SELECT ON public.store_category_order TO anon, authenticated;
GRANT ALL ON public.store_category_order TO service_role;
ALTER TABLE public.store_category_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sco_read" ON public.store_category_order FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_sco_category ON public.store_category_order(category_id);

-- 3. products extension
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.catalog_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_recommended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommended_order integer,
  ADD COLUMN IF NOT EXISTS approval_note text;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_recommended_order_check;
ALTER TABLE public.products ADD CONSTRAINT products_recommended_order_check CHECK (recommended_order IS NULL OR recommended_order BETWEEN 1 AND 6);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(merchant_id, category_id, sort_order);

CREATE OR REPLACE FUNCTION public.products_max_recommended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_recommended THEN
    IF (SELECT count(*) FROM public.products WHERE merchant_id = NEW.merchant_id AND is_recommended AND id <> NEW.id) >= 6 THEN
      RAISE EXCEPTION 'MAX_6_RECOMMENDED';
    END IF;
  ELSE
    NEW.recommended_order := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_products_max_recommended ON public.products;
CREATE TRIGGER trg_products_max_recommended BEFORE INSERT OR UPDATE OF is_recommended, recommended_order ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_max_recommended();

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_variants TO anon, authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pv_read" ON public.product_variants FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);

CREATE TABLE IF NOT EXISTS public.product_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_addons TO anon, authenticated;
GRANT ALL ON public.product_addons TO service_role;
ALTER TABLE public.product_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pa_read" ON public.product_addons FOR SELECT TO anon, authenticated USING (is_active OR public.is_super_admin_user());
CREATE INDEX IF NOT EXISTS idx_product_addons_product ON public.product_addons(product_id);

-- 4. sponsored slots
CREATE TABLE IF NOT EXISTS public.sponsored_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL CHECK (service_type IN ('store','food')),
  category_id uuid REFERENCES public.catalog_categories(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 6),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sponsored_slots TO anon, authenticated;
GRANT ALL ON public.sponsored_slots TO service_role;
ALTER TABLE public.sponsored_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ss_read" ON public.sponsored_slots FOR SELECT TO anon, authenticated USING (is_active OR public.is_super_admin_user());
CREATE UNIQUE INDEX IF NOT EXISTS uq_sponsored_active ON public.sponsored_slots(service_type, COALESCE(category_id,'00000000-0000-0000-0000-000000000000'::uuid), position) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_sponsored_store ON public.sponsored_slots(store_id);

-- 6. service settings
CREATE TABLE IF NOT EXISTS public.service_settings (
  service_key text PRIMARY KEY CHECK (service_key IN ('clean','store','food','parcel')),
  delivery_min_fare numeric NOT NULL DEFAULT 0,
  delivery_per_km numeric NOT NULL DEFAULT 0,
  rider_share_pct numeric NOT NULL DEFAULT 75,
  default_accept_timeout_minutes integer NOT NULL DEFAULT 5,
  is_live boolean NOT NULL DEFAULT true,
  timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.service_settings TO anon, authenticated;
GRANT ALL ON public.service_settings TO service_role;
ALTER TABLE public.service_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "svc_read" ON public.service_settings FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.service_settings(service_key, delivery_min_fare, delivery_per_km, default_accept_timeout_minutes, is_live) VALUES
  ('clean',0,0,5,true),('store',30,10,10,true),('food',30,10,5,false),('parcel',30,10,5,true)
ON CONFLICT DO NOTHING;

-- 7. tax settings
CREATE TABLE IF NOT EXISTS public.tax_settings (
  key text PRIMARY KEY,
  label text NOT NULL,
  rate_pct numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.tax_settings TO authenticated;
GRANT ALL ON public.tax_settings TO service_role;
ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax_read" ON public.tax_settings FOR SELECT TO authenticated USING (true);
INSERT INTO public.tax_settings(key,label,rate_pct,is_active) VALUES
  ('food_gst_9_5','Food GST (Sec 9(5))',5,true),
  ('delivery_gst','Delivery GST',18,true),
  ('commission_gst','Commission GST',18,true),
  ('platform_fee_gst','Platform fee GST',18,true),
  ('clean_gst','Clean service GST',0,false),
  ('store_tcs','Store TCS',0.5,true),
  ('tds_194o','TDS 194-O',0.1,true),
  ('tds_194o_threshold','TDS 194-O threshold (₹)',500000,true)
ON CONFLICT DO NOTHING;

-- 8. fee rules
CREATE TABLE IF NOT EXISTS public.fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  service_types text[] NOT NULL DEFAULT '{}',
  amount_type text NOT NULL DEFAULT 'flat' CHECK (amount_type IN ('flat','percent')),
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  gst_key text REFERENCES public.tax_settings(key),
  is_active boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fee_rules TO authenticated;
GRANT ALL ON public.fee_rules TO service_role;
ALTER TABLE public.fee_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fee_read" ON public.fee_rules FOR SELECT TO authenticated USING (true);
INSERT INTO public.fee_rules(name, service_types, amount_type, amount, gst_key, is_active)
SELECT 'Platform fee', ARRAY['clean','store','food','parcel'], 'flat', 0, 'platform_fee_gst', false
WHERE NOT EXISTS (SELECT 1 FROM public.fee_rules WHERE name = 'Platform fee');

-- Super admin manage policies for config tables
CREATE POLICY "cc_admin" ON public.catalog_categories FOR ALL TO authenticated USING (public.is_super_admin_user()) WITH CHECK (public.is_super_admin_user());
CREATE POLICY "ss_admin" ON public.sponsored_slots FOR ALL TO authenticated USING (public.is_super_admin_user()) WITH CHECK (public.is_super_admin_user());
CREATE POLICY "svc_admin" ON public.service_settings FOR ALL TO authenticated USING (public.is_super_admin_user()) WITH CHECK (public.is_super_admin_user());
CREATE POLICY "tax_admin" ON public.tax_settings FOR ALL TO authenticated USING (public.is_super_admin_user()) WITH CHECK (public.is_super_admin_user());
CREATE POLICY "fee_admin" ON public.fee_rules FOR ALL TO authenticated USING (public.is_super_admin_user()) WITH CHECK (public.is_super_admin_user());
GRANT INSERT, UPDATE, DELETE ON public.catalog_categories, public.sponsored_slots, public.service_settings, public.tax_settings, public.fee_rules TO authenticated;

-- 9. order money snapshot
ALTER TABLE public.merchant_orders
  ADD COLUMN IF NOT EXISTS item_total numeric,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_items numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_delivery numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_platform numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_payable numeric,
  ADD COLUMN IF NOT EXISTS commission_pct_applied numeric,
  ADD COLUMN IF NOT EXISTS commission_amount numeric,
  ADD COLUMN IF NOT EXISTS commission_gst numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rider_share_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merchant_net numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rates_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_merchant_orders_merchant_status ON public.merchant_orders(merchant_id, status);

-- 10. settlements
CREATE TABLE IF NOT EXISTS public.merchant_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.merchants(id),
  type text NOT NULL DEFAULT 'normal' CHECK (type IN ('normal','instant')),
  period_from date,
  period_to date,
  gross_amount numeric NOT NULL DEFAULT 0,
  commission_total numeric NOT NULL DEFAULT 0,
  commission_gst_total numeric NOT NULL DEFAULT 0,
  tcs_total numeric NOT NULL DEFAULT 0,
  tds_total numeric NOT NULL DEFAULT 0,
  instant_fee numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','failed','cancelled')),
  paid_at timestamptz,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.merchant_settlements TO authenticated;
GRANT ALL ON public.merchant_settlements TO service_role;
ALTER TABLE public.merchant_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ms_read" ON public.merchant_settlements FOR SELECT TO authenticated USING (
  public.is_super_admin_user() OR EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = store_id AND m.auth_user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_ms_store_status ON public.merchant_settlements(store_id, status);

CREATE TABLE IF NOT EXISTS public.merchant_settlement_items (
  settlement_id uuid NOT NULL REFERENCES public.merchant_settlements(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.merchant_orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (settlement_id, order_id)
);
GRANT SELECT ON public.merchant_settlement_items TO authenticated;
GRANT ALL ON public.merchant_settlement_items TO service_role;
ALTER TABLE public.merchant_settlement_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "msi_read" ON public.merchant_settlement_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.merchant_settlements s WHERE s.id = settlement_id));

-- 11. notify requests
CREATE TABLE IF NOT EXISTS public.notify_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  service_type text NOT NULL CHECK (service_type IN ('clean','store','food','parcel')),
  store_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('riders_busy','slots_full')),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','converted','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  converted_order_id uuid
);
GRANT SELECT ON public.notify_requests TO authenticated;
GRANT ALL ON public.notify_requests TO service_role;
ALTER TABLE public.notify_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nr_read" ON public.notify_requests FOR SELECT TO authenticated USING (customer_id = auth.uid() OR public.is_super_admin_user());
CREATE INDEX IF NOT EXISTS idx_notify_requests_status ON public.notify_requests(service_type, status);
CREATE INDEX IF NOT EXISTS idx_notify_requests_store ON public.notify_requests(store_id);

CREATE OR REPLACE FUNCTION public.create_notify_request(p_service_type text, p_reason text, p_store_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT id INTO v_id FROM public.notify_requests
   WHERE customer_id = v_uid AND service_type = p_service_type AND store_id IS NOT DISTINCT FROM p_store_id AND status = 'waiting';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.notify_requests(customer_id, service_type, store_id, reason)
  VALUES (v_uid, p_service_type, p_store_id, p_reason) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_notify_request(text,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_notify_request(text,text,uuid) TO authenticated;

-- 12. ratings
CREATE TABLE IF NOT EXISTS public.store_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.merchant_orders(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.store_ratings TO anon, authenticated;
GRANT ALL ON public.store_ratings TO service_role;
ALTER TABLE public.store_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sr_read" ON public.store_ratings FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_store_ratings_store ON public.store_ratings(store_id);

CREATE OR REPLACE FUNCTION public.store_ratings_recalc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store uuid := COALESCE(NEW.store_id, OLD.store_id);
BEGIN
  UPDATE public.merchants m SET
    rating_avg = COALESCE((SELECT round(avg(rating)::numeric,2) FROM public.store_ratings WHERE store_id = v_store),0),
    rating_count = (SELECT count(*) FROM public.store_ratings WHERE store_id = v_store)
  WHERE m.id = v_store;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_store_ratings_recalc ON public.store_ratings;
CREATE TRIGGER trg_store_ratings_recalc AFTER INSERT OR UPDATE OR DELETE ON public.store_ratings
  FOR EACH ROW EXECUTE FUNCTION public.store_ratings_recalc();

CREATE OR REPLACE FUNCTION public.submit_store_rating(p_order_id uuid, p_rating int, p_comment text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); o record; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'INVALID_RATING'; END IF;
  SELECT id, merchant_id, status, user_id INTO o FROM public.merchant_orders WHERE id = p_order_id;
  IF o.id IS NULL OR o.user_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF o.status <> 'delivered' THEN RAISE EXCEPTION 'NOT_DELIVERED'; END IF;
  INSERT INTO public.store_ratings(order_id, store_id, customer_id, rating, comment)
  VALUES (p_order_id, o.merchant_id, v_uid, p_rating, left(p_comment, 500))
  ON CONFLICT (order_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'ALREADY_RATED'; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_store_rating(uuid,int,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_store_rating(uuid,int,text) TO authenticated;
