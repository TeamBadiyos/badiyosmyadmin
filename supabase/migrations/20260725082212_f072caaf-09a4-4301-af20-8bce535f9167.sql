ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER TABLE public.bookings REPLICA IDENTITY FULL;

CREATE POLICY "Staff can read all bookings"
ON public.bookings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid() AND s.status = 'active'
  )
);