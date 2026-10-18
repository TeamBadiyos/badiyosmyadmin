CREATE OR REPLACE FUNCTION public.is_area_partner_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM staff_users WHERE auth_user_id=auth.uid() AND status='active' AND role='area_partner') $$;
REVOKE ALL ON FUNCTION public.is_area_partner_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_area_partner_staff() TO authenticated;

-- Area partners never read the customer table directly (raw phone numbers).
CREATE POLICY area_partner_no_customer_profiles ON public.users AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.is_area_partner_staff() OR id = auth.uid());

-- Customer name + phone for staff screens; phone masked for area partners, and only customers with bookings in their zones.
CREATE OR REPLACE FUNCTION public.staff_customer_brief(_ids uuid[]) RETURNS TABLE(id uuid, full_name text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _r text := staff_role();
BEGIN
  IF _r IS NULL THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF _r='area_partner' THEN
    RETURN QUERY SELECT u.id, u.full_name, mask_phone(u.phone) FROM users u
      WHERE u.id = ANY(_ids) AND EXISTS (SELECT 1 FROM bookings b WHERE b.user_id=u.id AND b.zone_id = ANY(staff_my_zone_ids()));
  ELSE
    RETURN QUERY SELECT u.id, u.full_name, u.phone FROM users u WHERE u.id = ANY(_ids);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.staff_customer_brief(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_customer_brief(uuid[]) TO authenticated;