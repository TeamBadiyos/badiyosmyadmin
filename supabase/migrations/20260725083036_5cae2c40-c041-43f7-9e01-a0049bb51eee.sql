
CREATE TABLE public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  boundary jsonb NOT NULL,
  assigned_area_partner_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.zones TO authenticated;
GRANT ALL ON public.zones TO service_role;

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active staff can read active zones"
  ON public.zones FOR SELECT
  TO authenticated
  USING (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.staff_users s
      WHERE s.auth_user_id = auth.uid() AND s.status = 'active'
    )
  );

ALTER TABLE public.experts
  ADD CONSTRAINT experts_zone_id_fkey
  FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;
