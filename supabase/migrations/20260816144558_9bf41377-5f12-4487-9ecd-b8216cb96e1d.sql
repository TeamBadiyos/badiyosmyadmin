CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_url text,
  pricing_type text NOT NULL DEFAULT 'duration',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.services ADD CONSTRAINT services_pricing_type_chk
  CHECK (pricing_type IN ('duration','flat','quantity'));
CREATE INDEX services_category_idx ON public.services(category_id);

CREATE TABLE public.service_price_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  label text NOT NULL,
  duration_minutes integer,
  unit_label text,
  customer_price numeric NOT NULL DEFAULT 0,
  strikethrough_price numeric,
  expert_payout numeric,
  partner_commission numeric,
  hq_share numeric,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_price_options_service_idx ON public.service_price_options(service_id);

GRANT SELECT ON public.services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
GRANT SELECT ON public.service_price_options TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_price_options TO authenticated;
GRANT ALL ON public.service_price_options TO service_role;

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_price_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services public read active chain" ON public.services
FOR SELECT TO anon, authenticated
USING (
  is_active AND EXISTS (
    SELECT 1 FROM public.service_categories c
    JOIN public.segments s ON s.id = c.segment_id
    WHERE c.id = services.category_id AND c.is_active AND s.is_active
  )
);
CREATE POLICY "services staff read" ON public.services
FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), NULL));
CREATE POLICY "services staff write" ON public.services
FOR ALL TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE POLICY "price options public read active chain" ON public.service_price_options
FOR SELECT TO anon, authenticated
USING (
  is_active AND EXISTS (
    SELECT 1 FROM public.services sv
    JOIN public.service_categories c ON c.id = sv.category_id
    JOIN public.segments s ON s.id = c.segment_id
    WHERE sv.id = service_price_options.service_id
      AND sv.is_active AND c.is_active AND s.is_active
  )
);
CREATE POLICY "price options staff read" ON public.service_price_options
FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid(), NULL));
CREATE POLICY "price options staff write" ON public.service_price_options
FOR ALL TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DO $$
DECLARE
  v_cat uuid;
  v_service uuid;
  r record;
  i integer := 0;
BEGIN
  SELECT id INTO v_cat FROM public.service_categories WHERE slug = 'home-cleaning' LIMIT 1;
  IF v_cat IS NULL THEN RETURN; END IF;

  INSERT INTO public.services (category_id, name, pricing_type, display_order, is_active)
  VALUES (v_cat, 'Home Cleaning', 'duration', 0, true)
  RETURNING id INTO v_service;

  FOR r IN
    SELECT * FROM public.service_catalogue_config
    WHERE service_category_id = v_cat
    ORDER BY duration_minutes NULLS LAST
  LOOP
    INSERT INTO public.service_price_options (
      service_id, label, duration_minutes, customer_price,
      expert_payout, partner_commission, hq_share, display_order, is_active
    ) VALUES (
      v_service, r.duration_label, r.duration_minutes, r.price,
      r.expert_payout, r.area_partner_payout, r.hq_revenue, i, COALESCE(r.is_active, true)
    );
    i := i + 1;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.is_public_service_image(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.services sv
    JOIN public.service_categories c ON c.id = sv.category_id
    JOIN public.segments s ON s.id = c.segment_id
    WHERE sv.is_active AND c.is_active AND s.is_active
      AND sv.id::text = split_part(object_name, '/', 1)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_public_service_image(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_public_service_image(text) TO anon, authenticated, service_role;