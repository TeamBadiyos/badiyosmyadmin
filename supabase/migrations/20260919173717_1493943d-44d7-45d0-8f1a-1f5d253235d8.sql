CREATE TABLE IF NOT EXISTS public.expert_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expert_id, zone_id)
);

GRANT SELECT ON public.expert_zones TO authenticated;
GRANT ALL ON public.expert_zones TO service_role;
ALTER TABLE public.expert_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read expert zones" ON public.expert_zones
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner']));

CREATE UNIQUE INDEX IF NOT EXISTS expert_zones_one_primary
  ON public.expert_zones(expert_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS expert_zones_zone_idx ON public.expert_zones(zone_id);

CREATE TABLE IF NOT EXISTS public.staff_user_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_user_id, zone_id)
);

GRANT SELECT ON public.staff_user_zones TO authenticated;
GRANT ALL ON public.staff_user_zones TO service_role;
ALTER TABLE public.staff_user_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read staff zones" ON public.staff_user_zones
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','area_partner']));

CREATE INDEX IF NOT EXISTS staff_user_zones_zone_idx ON public.staff_user_zones(zone_id);

-- Backfill from existing single-zone columns
INSERT INTO public.expert_zones (expert_id, zone_id, is_primary)
SELECT e.id, e.zone_id, true FROM public.experts e
WHERE e.zone_id IS NOT NULL
ON CONFLICT (expert_id, zone_id) DO NOTHING;

INSERT INTO public.staff_user_zones (staff_user_id, zone_id)
SELECT s.id, s.zone_id FROM public.staff_users s
WHERE s.zone_id IS NOT NULL
ON CONFLICT (staff_user_id, zone_id) DO NOTHING;

-- Zone scope helper for a staff auth user
CREATE OR REPLACE FUNCTION public.staff_zone_ids(_auth_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT array_agg(DISTINCT z.zone_id)
       FROM public.staff_user_zones z
       JOIN public.staff_users s ON s.id = z.staff_user_id
      WHERE s.auth_user_id = _auth_user_id),
    (SELECT CASE WHEN s.zone_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[s.zone_id] END
       FROM public.staff_users s WHERE s.auth_user_id = _auth_user_id LIMIT 1),
    ARRAY[]::uuid[]
  );
$$;

REVOKE ALL ON FUNCTION public.staff_zone_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_zone_ids(uuid) TO authenticated, service_role;

-- Set expert zones
CREATE OR REPLACE FUNCTION public.staff_set_expert_zones(_expert_id uuid, _zone_ids uuid[], _primary uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ids uuid[] := COALESCE(_zone_ids, ARRAY[]::uuid[]);
  _before uuid[];
  _prim uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.experts WHERE id = _expert_id) THEN
    RAISE EXCEPTION 'Expert not found';
  END IF;

  SELECT COALESCE(array_agg(zone_id), ARRAY[]::uuid[]) INTO _before
    FROM public.expert_zones WHERE expert_id = _expert_id;

  DELETE FROM public.expert_zones
   WHERE expert_id = _expert_id AND NOT (zone_id = ANY(_ids));

  INSERT INTO public.expert_zones (expert_id, zone_id, is_primary)
  SELECT _expert_id, z.id, false
    FROM public.zones z
   WHERE z.id = ANY(_ids) AND z.deleted_at IS NULL
  ON CONFLICT (expert_id, zone_id) DO NOTHING;

  _prim := _primary;
  IF _prim IS NULL OR NOT (_prim = ANY(_ids)) THEN
    SELECT ez.zone_id INTO _prim
      FROM public.expert_zones ez
      JOIN public.zones z ON z.id = ez.zone_id
     WHERE ez.expert_id = _expert_id
     ORDER BY z.name
     LIMIT 1;
  END IF;

  UPDATE public.expert_zones SET is_primary = false
   WHERE expert_id = _expert_id AND is_primary AND zone_id IS DISTINCT FROM _prim;
  UPDATE public.expert_zones SET is_primary = true
   WHERE expert_id = _expert_id AND zone_id = _prim;

  UPDATE public.experts SET zone_id = _prim WHERE id = _expert_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'set_expert_zones', 'experts', _expert_id,
         jsonb_build_object('zone_ids', _before),
         jsonb_build_object('zone_ids', _ids, 'primary_zone_id', _prim));
END $$;

REVOKE ALL ON FUNCTION public.staff_set_expert_zones(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_expert_zones(uuid, uuid[], uuid) TO authenticated, service_role;

-- Set staff user zones (super admin only)
CREATE OR REPLACE FUNCTION public.staff_set_staff_user_zones(_staff_user_id uuid, _zone_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ids uuid[] := COALESCE(_zone_ids, ARRAY[]::uuid[]);
  _before uuid[];
  _primary uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_users WHERE id = _staff_user_id) THEN
    RAISE EXCEPTION 'Staff user not found';
  END IF;

  SELECT COALESCE(array_agg(zone_id), ARRAY[]::uuid[]) INTO _before
    FROM public.staff_user_zones WHERE staff_user_id = _staff_user_id;

  DELETE FROM public.staff_user_zones
   WHERE staff_user_id = _staff_user_id AND NOT (zone_id = ANY(_ids));

  INSERT INTO public.staff_user_zones (staff_user_id, zone_id)
  SELECT _staff_user_id, z.id
    FROM public.zones z
   WHERE z.id = ANY(_ids) AND z.deleted_at IS NULL
  ON CONFLICT (staff_user_id, zone_id) DO NOTHING;

  SELECT sz.zone_id INTO _primary
    FROM public.staff_user_zones sz
    JOIN public.zones z ON z.id = sz.zone_id
   WHERE sz.staff_user_id = _staff_user_id
   ORDER BY z.name
   LIMIT 1;

  UPDATE public.staff_users SET zone_id = _primary WHERE id = _staff_user_id;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES(_uid, 'set_staff_user_zones', 'staff_users', _staff_user_id,
         jsonb_build_object('zone_ids', _before),
         jsonb_build_object('zone_ids', _ids, 'primary_zone_id', _primary));
END $$;

REVOKE ALL ON FUNCTION public.staff_set_staff_user_zones(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_set_staff_user_zones(uuid, uuid[]) TO authenticated, service_role;