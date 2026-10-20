DELETE FROM auth.users WHERE is_anonymous = true;

DROP POLICY IF EXISTS sr_read ON public.store_ratings;
CREATE POLICY sr_staff_read ON public.store_ratings FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
REVOKE SELECT ON public.store_ratings FROM anon;

DROP POLICY IF EXISTS fee_read ON public.fee_rules;
CREATE POLICY fee_staff_read ON public.fee_rules FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
REVOKE SELECT ON public.fee_rules FROM anon;

DROP POLICY IF EXISTS tax_read ON public.tax_settings;
CREATE POLICY tax_staff_read ON public.tax_settings FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
REVOKE SELECT ON public.tax_settings FROM anon;

DROP POLICY IF EXISTS "Signed-in can read city ops settings" ON public.city_ops_settings;
CREATE POLICY city_ops_staff_read ON public.city_ops_settings FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
REVOKE SELECT ON public.city_ops_settings FROM anon;

DROP POLICY IF EXISTS "read bonus rules" ON public.wallet_bonus_rules;
CREATE POLICY bonus_rules_staff_read ON public.wallet_bonus_rules FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
REVOKE SELECT ON public.wallet_bonus_rules FROM anon;

DROP POLICY IF EXISTS "Anyone can view referral config" ON public.referral_config;
CREATE POLICY referral_config_auth_read ON public.referral_config FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.referral_config FROM anon;

DROP POLICY IF EXISTS "Anyone signed in reads merchant referral config" ON public.merchant_referral_config;
CREATE POLICY merchant_referral_config_read ON public.merchant_referral_config FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()) OR public.current_merchant_id() IS NOT NULL);
REVOKE SELECT ON public.merchant_referral_config FROM anon;

COMMENT ON VIEW public.public_stores IS 'Intentional SECURITY DEFINER — exposes only approved/active safe columns to guests. Do not set security_invoker.';
COMMENT ON VIEW public.public_products IS 'Intentional SECURITY DEFINER — exposes only approved/active safe columns to guests. Do not set security_invoker.';