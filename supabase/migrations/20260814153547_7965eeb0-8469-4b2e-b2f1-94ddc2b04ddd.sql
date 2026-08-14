GRANT SELECT ON public.waitlist_requests TO authenticated;
GRANT ALL ON public.waitlist_requests TO service_role;
ALTER TABLE public.waitlist_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view waitlist requests"
  ON public.waitlist_requests
  FOR SELECT
  TO authenticated
  USING (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));