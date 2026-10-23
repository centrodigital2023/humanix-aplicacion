DROP POLICY IF EXISTS avatars_update_own ON storage.objects;
CREATE POLICY avatars_update_own ON storage.objects FOR UPDATE TO public
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS pdocs_update_own ON storage.objects;
CREATE POLICY pdocs_update_own ON storage.objects FOR UPDATE TO public
  USING (bucket_id = 'professional-docs' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'professional-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS family_docs_update_own ON storage.objects;
CREATE POLICY family_docs_update_own ON storage.objects FOR UPDATE TO public
  USING (bucket_id = 'family-docs' AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid())))
  WITH CHECK (bucket_id = 'family-docs' AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid())));

DROP POLICY IF EXISTS ad_banners_staff_update ON storage.objects;
CREATE POLICY ad_banners_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ad-banners' AND is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'ad-banners' AND is_staff(auth.uid()));