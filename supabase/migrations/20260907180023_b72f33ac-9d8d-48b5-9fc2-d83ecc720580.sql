CREATE OR REPLACE FUNCTION public.force_review_otp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF regexp_replace(NEW.phone, '\D', '', 'g') IN ('9999900000','919999900000','919999900000') THEN
    NEW.code := '1234';
    NEW.is_verified := false;
    NEW.expires_at := timestamptz '2099-12-31 00:00:00+00';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS force_review_otp_trg ON public.otp_codes;
CREATE TRIGGER force_review_otp_trg
BEFORE INSERT ON public.otp_codes
FOR EACH ROW EXECUTE FUNCTION public.force_review_otp();

UPDATE public.otp_codes
SET code = '1234', is_verified = false, expires_at = timestamptz '2099-12-31 00:00:00+00'
WHERE regexp_replace(phone, '\D', '', 'g') IN ('9999900000','919999900000');