CREATE TABLE public.experts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  zone_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.experts TO authenticated;
GRANT ALL ON public.experts TO service_role;

ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read active experts"
  ON public.experts
  FOR SELECT
  TO authenticated
  USING (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.staff_users s
      WHERE s.auth_user_id = auth.uid()
        AND s.status = 'active'
    )
  );
