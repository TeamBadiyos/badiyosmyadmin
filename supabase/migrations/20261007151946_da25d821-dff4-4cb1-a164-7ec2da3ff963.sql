CREATE POLICY "catalog_images_public_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'catalog-images');

CREATE POLICY "catalog_images_merchant_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'catalog-images' AND current_merchant_id() IS NOT NULL AND (
    (storage.foldername(name))[1] = current_merchant_id()::text
    OR ((storage.foldername(name))[1] = '_thumbs' AND (storage.foldername(name))[2] = current_merchant_id()::text)));
CREATE POLICY "catalog_images_merchant_update" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'catalog-images' AND current_merchant_id() IS NOT NULL AND (
    (storage.foldername(name))[1] = current_merchant_id()::text
    OR ((storage.foldername(name))[1] = '_thumbs' AND (storage.foldername(name))[2] = current_merchant_id()::text)))
WITH CHECK (
  bucket_id = 'catalog-images' AND current_merchant_id() IS NOT NULL AND (
    (storage.foldername(name))[1] = current_merchant_id()::text
    OR ((storage.foldername(name))[1] = '_thumbs' AND (storage.foldername(name))[2] = current_merchant_id()::text)));
CREATE POLICY "catalog_images_merchant_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'catalog-images' AND current_merchant_id() IS NOT NULL AND (
    (storage.foldername(name))[1] = current_merchant_id()::text
    OR ((storage.foldername(name))[1] = '_thumbs' AND (storage.foldername(name))[2] = current_merchant_id()::text)));

CREATE POLICY "catalog_images_staff_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'catalog-images' AND is_active_staff(auth.uid(), NULL::text[]));
CREATE POLICY "catalog_images_staff_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'catalog-images' AND is_active_staff(auth.uid(), NULL::text[])) WITH CHECK (bucket_id = 'catalog-images' AND is_active_staff(auth.uid(), NULL::text[]));
CREATE POLICY "catalog_images_staff_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'catalog-images' AND is_active_staff(auth.uid(), NULL::text[]));