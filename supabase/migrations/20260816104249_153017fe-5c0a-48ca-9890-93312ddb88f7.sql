CREATE OR REPLACE FUNCTION public.is_public_product_image(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.products p
    JOIN public.merchants m ON m.id = p.merchant_id
    WHERE p.is_active = true
      AND m.status = 'approved'
      AND p.image_url IS NOT NULL
      AND p.image_url LIKE '%' || _object_name
  );
$$;

REVOKE ALL ON FUNCTION public.is_public_product_image(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_product_image(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public read active product images" ON storage.objects;
CREATE POLICY "Public read active product images"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'product-images'
  AND public.is_public_product_image(name)
);