CREATE POLICY "Staff can read all users"
ON public.users
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.staff_users s
  WHERE s.auth_user_id = auth.uid() AND s.status = 'active'
));