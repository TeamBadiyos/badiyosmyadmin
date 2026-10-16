CREATE OR REPLACE FUNCTION public.merchants_fssai_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND NEW.service_type = 'food' THEN
    IF coalesce(btrim(NEW.fssai_number), '') = '' THEN
      RAISE EXCEPTION 'FSSAI licence number is missing — restaurant cannot be approved';
    END IF;
    IF NEW.fssai_expiry IS NULL THEN
      RAISE EXCEPTION 'FSSAI expiry date is missing — restaurant cannot be approved';
    END IF;
    IF NEW.fssai_expiry::date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      RAISE EXCEPTION 'FSSAI licence has expired — restaurant cannot be approved';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.merchant_documents d WHERE d.merchant_id = NEW.id
                   AND d.doc_type ILIKE 'fssai%' AND coalesce(d.file_url, '') <> '') THEN
      RAISE EXCEPTION 'FSSAI licence file is missing — restaurant cannot be approved';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS merchants_fssai_approval_guard ON public.merchants;
CREATE TRIGGER merchants_fssai_approval_guard BEFORE UPDATE OF status ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.merchants_fssai_approval_guard();