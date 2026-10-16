REVOKE EXECUTE ON FUNCTION public.merchant_referral_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.merchant_referral_on_order() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_merchant_referrals() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_update_merchant_referral_config(numeric, integer, integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_mark_merchant_referral_earned(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.staff_reverse_merchant_referral(uuid, text) FROM PUBLIC, anon;
ALTER POLICY "staff read merchant referrals" ON public.merchant_referrals TO authenticated;