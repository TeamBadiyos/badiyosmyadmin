
CREATE TABLE public.area_partner_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  area text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.area_partner_leads TO authenticated;
GRANT ALL ON public.area_partner_leads TO service_role;
ALTER TABLE public.area_partner_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read leads" ON public.area_partner_leads
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s
                 WHERE s.auth_user_id = auth.uid() AND s.status = 'active'));

CREATE TABLE public.expert_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  area text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.expert_leads TO authenticated;
GRANT ALL ON public.expert_leads TO service_role;
ALTER TABLE public.expert_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read expert leads" ON public.expert_leads
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s
                 WHERE s.auth_user_id = auth.uid() AND s.status = 'active'));

CREATE TABLE public.support_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_inquiries TO authenticated;
GRANT ALL ON public.support_inquiries TO service_role;
ALTER TABLE public.support_inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read support inquiries" ON public.support_inquiries
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_users s
                 WHERE s.auth_user_id = auth.uid() AND s.status = 'active'));
