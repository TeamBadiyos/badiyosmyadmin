ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_audience_chk;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_audience_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_audience_check
  CHECK (audience = ANY (ARRAY['all','targeted','referral_reward','new_customers','existing_customers']));