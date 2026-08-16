CREATE POLICY "service images public read when chain active"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'service-images' AND public.is_public_service_image(name));

CREATE POLICY "service images staff read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'service-images' AND public.is_active_staff(auth.uid(), NULL));

CREATE POLICY "service images staff insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'service-images' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE POLICY "service images staff update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'service-images' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']))
WITH CHECK (bucket_id = 'service-images' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));

CREATE POLICY "service images staff delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'service-images' AND public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager']));