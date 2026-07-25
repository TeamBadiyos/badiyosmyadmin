
-- Broaden staff read policies so authenticated server functions can drop supabaseAdmin fallbacks.

CREATE POLICY "Super admin can read all staff_users"
  ON public.staff_users FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin']));

CREATE POLICY "Staff can read all zones"
  ON public.zones FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "Staff can read all experts"
  ON public.experts FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "Staff can read all area_partners"
  ON public.area_partners FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "Staff can read all homepage_sections"
  ON public.homepage_sections FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE POLICY "Staff can read all service_catalogue_config"
  ON public.service_catalogue_config FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "Super admin can read referral_transactions"
  ON public.referral_transactions FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), ARRAY['super_admin']));

CREATE POLICY "Staff can read addresses"
  ON public.addresses FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL));
