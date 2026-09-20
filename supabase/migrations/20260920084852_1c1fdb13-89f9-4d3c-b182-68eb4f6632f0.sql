REVOKE EXECUTE ON FUNCTION public.reward_check_expert_referral(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reward_check_expert_referral(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.bookings_after_complete_expert_referral() FROM PUBLIC, anon, authenticated;