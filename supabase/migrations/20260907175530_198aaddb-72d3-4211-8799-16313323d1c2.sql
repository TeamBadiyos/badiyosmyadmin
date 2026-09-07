-- Profile row for the app-review test account
INSERT INTO public.users (id, full_name, phone)
VALUES ('ac774e78-685d-490d-a904-9ff36c4b367c', 'App Review Tester', '919999900000')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone;

-- Fixed, non-expiring OTP for the reserved review phone (both stored formats)
DELETE FROM public.otp_codes WHERE phone IN ('919999900000', '+919999900000', '9999900000');

INSERT INTO public.otp_codes (phone, code, is_verified, expires_at)
VALUES
  ('919999900000', '1234', false, '2099-12-31T00:00:00Z'),
  ('+919999900000', '1234', false, '2099-12-31T00:00:00Z'),
  ('9999900000', '1234', false, '2099-12-31T00:00:00Z');

-- Keep the review OTP permanently reusable: after any verification/expiry
-- update, reset it back to a fresh, unverified, non-expiring state.
CREATE OR REPLACE FUNCTION public.keep_review_otp_valid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF regexp_replace(NEW.phone, '\D', '', 'g') IN ('919999900000', '9999900000')
     AND NEW.code = '1234' THEN
    NEW.is_verified := false;
    NEW.expires_at := TIMESTAMPTZ '2099-12-31 00:00:00+00';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keep_review_otp_valid_trg ON public.otp_codes;
CREATE TRIGGER keep_review_otp_valid_trg
BEFORE UPDATE ON public.otp_codes
FOR EACH ROW EXECUTE FUNCTION public.keep_review_otp_valid();

REVOKE ALL ON FUNCTION public.keep_review_otp_valid() FROM PUBLIC, anon, authenticated;