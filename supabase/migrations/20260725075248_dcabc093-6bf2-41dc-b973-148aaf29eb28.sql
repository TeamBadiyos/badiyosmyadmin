CREATE TABLE public.staff_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('super_admin', 'ops_manager', 'area_partner')),
  zone_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.staff_users TO authenticated;
GRANT ALL ON public.staff_users TO service_role;

ALTER TABLE public.staff_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read their own row"
  ON public.staff_users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = auth_user_id);