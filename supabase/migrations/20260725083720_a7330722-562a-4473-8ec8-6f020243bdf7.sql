
-- 1. area_partners table
CREATE TABLE IF NOT EXISTS public.area_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.area_partners TO authenticated;
GRANT ALL ON public.area_partners TO service_role;
ALTER TABLE public.area_partners ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='area_partners' AND policyname='Staff can read active area partners') THEN
    CREATE POLICY "Staff can read active area partners" ON public.area_partners
      FOR SELECT TO authenticated
      USING (status = 'active' AND EXISTS (
        SELECT 1 FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.status='active'
      ));
  END IF;
END $$;

-- 2. zones.assigned_area_partner_id FK
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name='zones_assigned_area_partner_fk'
  ) THEN
    ALTER TABLE public.zones
      ADD CONSTRAINT zones_assigned_area_partner_fk
      FOREIGN KEY (assigned_area_partner_id) REFERENCES public.area_partners(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. bookings.zone_id
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL;

-- 4. Point-in-polygon (ray casting) over a jsonb array [{lat,lng},...]
CREATE OR REPLACE FUNCTION public.point_in_polygon(_lat numeric, _lng numeric, _poly jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n int;
  i int;
  j int;
  xi numeric; yi numeric;
  xj numeric; yj numeric;
  inside boolean := false;
BEGIN
  IF _poly IS NULL OR jsonb_typeof(_poly) <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(_poly);
  IF n < 3 THEN RETURN false; END IF;
  j := n - 1;
  FOR i IN 0..n-1 LOOP
    xi := (_poly->i->>'lng')::numeric;
    yi := (_poly->i->>'lat')::numeric;
    xj := (_poly->j->>'lng')::numeric;
    yj := (_poly->j->>'lat')::numeric;
    IF ((yi > _lat) <> (yj > _lat))
       AND (_lng < (xj - xi) * (_lat - yi) / NULLIF((yj - yi),0) + xi) THEN
      inside := NOT inside;
    END IF;
    j := i;
  END LOOP;
  RETURN inside;
END;$$;

-- 5. Resolve zone containing a point (first active match)
CREATE OR REPLACE FUNCTION public.resolve_zone_for_point(_lat numeric, _lng numeric)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _zone_id uuid;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _zone_id
    FROM public.zones
   WHERE status = 'active'
     AND public.point_in_polygon(_lat, _lng, boundary)
   ORDER BY created_at ASC
   LIMIT 1;
  RETURN _zone_id;
END;$$;

GRANT EXECUTE ON FUNCTION public.resolve_zone_for_point(numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.point_in_polygon(numeric, numeric, jsonb) TO authenticated, service_role;

-- 6. staff_assign_area_partner RPC
CREATE OR REPLACE FUNCTION public.staff_assign_area_partner(_zone_id uuid, _partner_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _partner_ok boolean;
  _before jsonb;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT role INTO _role FROM public.staff_users WHERE auth_user_id = _uid AND status='active';
  IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _partner_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.area_partners WHERE id=_partner_id AND status='active') INTO _partner_ok;
    IF NOT _partner_ok THEN RAISE EXCEPTION 'Area partner not available'; END IF;
  END IF;
  SELECT to_jsonb(z) INTO _before FROM public.zones z WHERE id = _zone_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Zone not found'; END IF;
  UPDATE public.zones SET assigned_area_partner_id = _partner_id WHERE id = _zone_id;
  SELECT to_jsonb(z) INTO _after FROM public.zones z WHERE id = _zone_id;
  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'assign_area_partner', 'zones', _zone_id, _before, _after);
END;$$;

-- 7. Update staff_accept_booking to also stamp zone_id from address lat/lng
CREATE OR REPLACE FUNCTION public.staff_accept_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_staff boolean;
  _current text;
  _addr uuid;
  _lat numeric;
  _lng numeric;
  _zone uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _uid AND status = 'active')
    INTO _is_staff;
  IF NOT _is_staff THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT status, address_id INTO _current, _addr FROM public.bookings WHERE id = _booking_id;
  IF _current IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _current <> 'confirmed' THEN RAISE EXCEPTION 'Booking not pending'; END IF;
  IF _addr IS NOT NULL THEN
    SELECT latitude, longitude INTO _lat, _lng FROM public.addresses WHERE id = _addr;
    _zone := public.resolve_zone_for_point(_lat, _lng);
  END IF;
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings SET status = 'accepted', zone_id = COALESCE(_zone, zone_id) WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass', 'off', true);
END;$$;
