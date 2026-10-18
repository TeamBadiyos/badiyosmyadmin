CREATE POLICY area_partner_own_zone_bookings ON public.bookings AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_area_partner_staff() OR zone_id = ANY(public.staff_my_zone_ids()) OR user_id = auth.uid())
  WITH CHECK (NOT public.is_area_partner_staff() OR zone_id = ANY(public.staff_my_zone_ids()) OR user_id = auth.uid());