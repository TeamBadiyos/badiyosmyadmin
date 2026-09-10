CREATE POLICY "Staff can read wallet transactions"
ON public.wallet_transactions FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE POLICY "Staff can read referral transactions"
ON public.referral_transactions FOR SELECT TO authenticated
USING (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));