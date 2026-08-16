REVOKE EXECUTE ON FUNCTION public.merchant_is_currently_open(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.merchant_is_currently_open(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated can read product images" ON storage.objects;
CREATE POLICY "Authenticated can read approved store product images"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id::text = (storage.foldername(name))[1]
      AND m.status = 'approved'
  )
);

ALTER TABLE public.support_inquiries
  ADD CONSTRAINT support_inquiries_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  ADD CONSTRAINT support_inquiries_contact_len CHECK (char_length(btrim(contact)) BETWEEN 3 AND 160),
  ADD CONSTRAINT support_inquiries_message_len CHECK (char_length(btrim(message)) BETWEEN 5 AND 4000);

DROP POLICY IF EXISTS "Anyone can submit a support inquiry" ON public.support_inquiries;
CREATE POLICY "Anyone can submit a support inquiry"
ON public.support_inquiries FOR INSERT TO anon, authenticated
WITH CHECK (
  status = 'open'
  AND char_length(btrim(name)) BETWEEN 1 AND 120
  AND char_length(btrim(contact)) BETWEEN 3 AND 160
  AND char_length(btrim(message)) BETWEEN 5 AND 4000
);