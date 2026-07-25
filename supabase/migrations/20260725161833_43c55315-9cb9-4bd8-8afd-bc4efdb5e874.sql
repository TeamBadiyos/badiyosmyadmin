-- 1) Public INSERT policies for lead capture tables
DROP POLICY IF EXISTS "Public can submit area partner leads" ON public.area_partner_leads;
CREATE POLICY "Public can submit area partner leads"
ON public.area_partner_leads FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Public can submit expert leads" ON public.expert_leads;
CREATE POLICY "Public can submit expert leads"
ON public.expert_leads FOR INSERT TO anon, authenticated WITH CHECK (true);

GRANT INSERT ON public.area_partner_leads TO anon, authenticated;
GRANT INSERT ON public.expert_leads TO anon, authenticated;

-- 2) Expert-scoped INSERT policy on emergency_alerts
DROP POLICY IF EXISTS "Experts can insert own emergency alerts" ON public.emergency_alerts;
CREATE POLICY "Experts can insert own emergency alerts"
ON public.emergency_alerts FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.experts e
    WHERE e.id = emergency_alerts.expert_id
      AND e.auth_user_id = auth.uid()
  )
);

-- 3) Replace SECURITY DEFINER view with a SECURITY INVOKER view + narrow policy scoped to safe columns
DROP VIEW IF EXISTS public.assigned_expert_public;

CREATE OR REPLACE FUNCTION public.get_assigned_expert_public(_booking_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  photo_url text,
  level text,
  status text,
  zone_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.name, e.phone, e.photo_url, e.level, e.status, e.zone_id
    FROM public.bookings b
    JOIN public.experts e ON e.id = b.assigned_expert_id
   WHERE b.id = _booking_id
     AND b.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_assigned_expert_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_assigned_expert_public(uuid) TO authenticated;

-- 4) Revoke EXECUTE from anon on all SECURITY DEFINER functions in public schema
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon;', r.proname, r.args);
  END LOOP;
END $$;

-- Keep haversine_km executable by anon (it's IMMUTABLE and not sensitive) — but it's not SECURITY DEFINER so unaffected.