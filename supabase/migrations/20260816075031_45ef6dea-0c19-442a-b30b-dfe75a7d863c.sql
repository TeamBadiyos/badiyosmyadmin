CREATE TABLE public.business_interest_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text,
  owner_name text NOT NULL,
  phone text NOT NULL,
  category_interested text NOT NULL,
  city text NOT NULL DEFAULT 'Latur',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.business_interest_leads TO anon;
GRANT INSERT, SELECT ON public.business_interest_leads TO authenticated;
GRANT ALL ON public.business_interest_leads TO service_role;

ALTER TABLE public.business_interest_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit business interest"
  ON public.business_interest_leads FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Staff can read business interest"
  ON public.business_interest_leads FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE TABLE public.city_interest_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  city text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.city_interest_leads TO anon;
GRANT INSERT, SELECT ON public.city_interest_leads TO authenticated;
GRANT ALL ON public.city_interest_leads TO service_role;

ALTER TABLE public.city_interest_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit city interest"
  ON public.city_interest_leads FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Staff can read city interest"
  ON public.city_interest_leads FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE INDEX idx_business_interest_leads_created_at ON public.business_interest_leads (created_at DESC);
CREATE INDEX idx_city_interest_leads_created_at ON public.city_interest_leads (created_at DESC);