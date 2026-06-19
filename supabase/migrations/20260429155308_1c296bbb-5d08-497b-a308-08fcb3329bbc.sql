INSERT INTO storage.buckets (id, name, public)
VALUES ('ad-banners', 'ad-banners', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ad_banners_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'ad-banners');

CREATE POLICY "ad_banners_staff_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ad-banners' AND public.is_staff(auth.uid()));

CREATE POLICY "ad_banners_staff_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'ad-banners' AND public.is_staff(auth.uid()));

CREATE POLICY "ad_banners_staff_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'ad-banners' AND public.is_staff(auth.uid()));