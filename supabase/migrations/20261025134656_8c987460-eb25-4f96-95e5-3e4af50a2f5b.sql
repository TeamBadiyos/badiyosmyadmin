CREATE POLICY "Staff read tips" ON public.booking_tips FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), NULL::text[]) AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = booking_tips.booking_id));
GRANT SELECT ON public.booking_tips TO authenticated;