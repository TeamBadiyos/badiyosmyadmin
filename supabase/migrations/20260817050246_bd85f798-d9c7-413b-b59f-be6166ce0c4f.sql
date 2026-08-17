CREATE TABLE IF NOT EXISTS public.availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('category','item')),
  target_id uuid NOT NULL,
  is_unavailable boolean NOT NULL DEFAULT false,
  unavailable_from timestamptz,
  unavailable_until timestamptz,
  reason text,
  created_by uuid REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS availability_overrides_target_uniq
  ON public.availability_overrides (target_type, target_id);

GRANT SELECT ON public.availability_overrides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.availability_overrides TO authenticated;
GRANT ALL ON public.availability_overrides TO service_role;

ALTER TABLE public.availability_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read availability overrides" ON public.availability_overrides;
CREATE POLICY "Anyone can read availability overrides"
  ON public.availability_overrides FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Staff can insert availability overrides" ON public.availability_overrides;
CREATE POLICY "Staff can insert availability overrides"
  ON public.availability_overrides FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "Staff can update availability overrides" ON public.availability_overrides;
CREATE POLICY "Staff can update availability overrides"
  ON public.availability_overrides FOR UPDATE TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
  WITH CHECK (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

DROP POLICY IF EXISTS "Staff can delete availability overrides" ON public.availability_overrides;
CREATE POLICY "Staff can delete availability overrides"
  ON public.availability_overrides FOR DELETE TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE OR REPLACE FUNCTION public.is_target_unavailable(_target_type text, _target_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(bool_or(
    o.is_unavailable
    OR (o.unavailable_from IS NOT NULL AND o.unavailable_until IS NOT NULL
        AND now() >= o.unavailable_from AND now() < o.unavailable_until)
  ), false)
  FROM public.availability_overrides o
  WHERE o.target_type = _target_type AND o.target_id = _target_id;
$$;

REVOKE ALL ON FUNCTION public.is_target_unavailable(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_target_unavailable(text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_set_availability_override(
  _target_type text,
  _target_id uuid,
  _is_unavailable boolean,
  _unavailable_from timestamptz,
  _unavailable_until timestamptz,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _staff uuid;
  _id uuid;
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _target_type NOT IN ('category','item') THEN
    RAISE EXCEPTION 'Invalid target_type';
  END IF;
  IF _unavailable_from IS NOT NULL AND _unavailable_until IS NOT NULL
     AND _unavailable_until <= _unavailable_from THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;

  SELECT id INTO _staff FROM public.staff_users WHERE auth_user_id = auth.uid();

  INSERT INTO public.availability_overrides
    (target_type, target_id, is_unavailable, unavailable_from, unavailable_until, reason, created_by)
  VALUES
    (_target_type, _target_id, COALESCE(_is_unavailable,false), _unavailable_from, _unavailable_until, NULLIF(btrim(COALESCE(_reason,'')),''), _staff)
  ON CONFLICT (target_type, target_id) DO UPDATE SET
    is_unavailable = EXCLUDED.is_unavailable,
    unavailable_from = EXCLUDED.unavailable_from,
    unavailable_until = EXCLUDED.unavailable_until,
    reason = EXCLUDED.reason,
    created_by = EXCLUDED.created_by,
    updated_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_set_availability_override(text, uuid, boolean, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_set_availability_override(text, uuid, boolean, timestamptz, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_clear_availability_override(_target_type text, _target_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  DELETE FROM public.availability_overrides
   WHERE target_type = _target_type AND target_id = _target_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_clear_availability_override(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_clear_availability_override(text, uuid) TO authenticated, service_role;