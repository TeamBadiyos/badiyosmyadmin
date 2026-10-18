CREATE OR REPLACE FUNCTION public.ap_check_assign(_booking_id uuid, _expert_id uuid) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.ap_require_booking(_booking_id);
  IF NOT EXISTS (SELECT 1 FROM expert_zones ez WHERE ez.expert_id=_expert_id AND ez.zone_id = ANY(staff_my_zone_ids()))
     AND NOT EXISTS (SELECT 1 FROM experts e WHERE e.id=_expert_id AND e.zone_id = ANY(staff_my_zone_ids())) THEN
    RAISE EXCEPTION 'This expert is not in your zones' USING errcode='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM expert_leave_days WHERE expert_id=_expert_id AND leave_date=(now() AT TIME ZONE 'Asia/Kolkata')::date) THEN
    RAISE EXCEPTION 'This expert is on leave today';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ap_check_assign(uuid,uuid) FROM PUBLIC, anon, authenticated;

DO $do$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.staff_assign_expert'::regproc);
  d := replace(d, $x$IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;$x$, $x$IF public.is_area_partner_staff() THEN
    PERFORM public.ap_check_assign(_booking_id, _expert_id);
  ELSIF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;$x$);
  IF d NOT LIKE '%ap_check_assign%' THEN RAISE EXCEPTION 'assign patch failed'; END IF;
  EXECUTE d;
  d := pg_get_functiondef('public.staff_reassign_expert'::regproc);
  d := replace(d, $x$IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager') THEN RAISE EXCEPTION 'Forbidden'; END IF;$x$,
    $x$IF _role IS NULL OR _role NOT IN ('super_admin','ops_manager','area_partner') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _role = 'area_partner' THEN PERFORM public.ap_check_assign(_booking_id, _new_expert_id); END IF;$x$);
  IF d NOT LIKE '%ap_check_assign%' THEN RAISE EXCEPTION 'reassign patch failed'; END IF;
  EXECUTE d;
END $do$;