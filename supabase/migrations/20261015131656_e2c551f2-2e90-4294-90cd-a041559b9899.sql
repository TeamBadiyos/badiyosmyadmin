REVOKE ALL ON FUNCTION public.is_delivery_rider(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.booking_capacity_group(uuid,text) FROM anon;
DROP POLICY IF EXISTS "Staff read weekday capacity" ON public.slot_capacity_weekday;
CREATE POLICY "Staff read weekday capacity" ON public.slot_capacity_weekday FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));