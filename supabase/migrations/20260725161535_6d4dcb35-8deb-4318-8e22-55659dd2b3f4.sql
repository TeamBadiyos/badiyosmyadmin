-- 1) Expert live location
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS current_lat numeric,
  ADD COLUMN IF NOT EXISTS current_lng numeric,
  ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;

-- 3) Booking coordinates
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_lat numeric,
  ADD COLUMN IF NOT EXISTS booking_lng numeric;

-- 2) Dispatch config table
CREATE TABLE IF NOT EXISTS public.dispatch_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL DEFAULT 'Latur',
  broadcast_radius_km numeric NOT NULL DEFAULT 5,
  broadcast_timeout_seconds integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dispatch_config TO authenticated;
GRANT ALL ON public.dispatch_config TO service_role;

ALTER TABLE public.dispatch_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read dispatch config" ON public.dispatch_config;
CREATE POLICY "Authenticated can read dispatch config"
ON public.dispatch_config
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Super admin can insert dispatch config" ON public.dispatch_config;
CREATE POLICY "Super admin can insert dispatch config"
ON public.dispatch_config
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid()
      AND s.status = 'active'
      AND s.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "Super admin can update dispatch config" ON public.dispatch_config;
CREATE POLICY "Super admin can update dispatch config"
ON public.dispatch_config
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid()
      AND s.status = 'active'
      AND s.role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid()
      AND s.status = 'active'
      AND s.role = 'super_admin'
  )
);

DROP POLICY IF EXISTS "Super admin can delete dispatch config" ON public.dispatch_config;
CREATE POLICY "Super admin can delete dispatch config"
ON public.dispatch_config
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid()
      AND s.status = 'active'
      AND s.role = 'super_admin'
  )
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_dispatch_config_updated_at ON public.dispatch_config;
CREATE TRIGGER update_dispatch_config_updated_at
BEFORE UPDATE ON public.dispatch_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed a single default row if empty
INSERT INTO public.dispatch_config (city, broadcast_radius_km, broadcast_timeout_seconds)
SELECT 'Latur', 5, 90
WHERE NOT EXISTS (SELECT 1 FROM public.dispatch_config);

-- 4) Haversine distance in kilometres
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (2 * 6371 * asin(
    sqrt(
      sin(radians(((lat2 - lat1))::float8) / 2) ^ 2
      + cos(radians(lat1::float8)) * cos(radians(lat2::float8))
        * sin(radians(((lng2 - lng1))::float8) / 2) ^ 2
    )
  ))::numeric;
$$;