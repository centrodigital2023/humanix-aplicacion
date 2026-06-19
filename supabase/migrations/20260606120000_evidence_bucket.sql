-- Storage bucket for clinical check-in/out evidence (photos + digital signatures).
-- Used by CheckInOut.tsx → uploadEvidence(): path = checkins/{booking_id}/{professional_id}/{ts}.{ext}
-- Private bucket: evidence may contain images of patients/homes, so it is NOT public.

INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO NOTHING;

-- SELECT: the uploading professional, the family/client of the related booking, or staff
DROP POLICY IF EXISTS evidence_select_related ON storage.objects;
CREATE POLICY evidence_select_related ON storage.objects
  FOR SELECT USING (
    bucket_id = 'evidence'
    AND (
      auth.uid()::text = (storage.foldername(name))[2]
      OR is_staff(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.service_bookings sb
        WHERE sb.id::text = (storage.foldername(name))[1]
          AND (sb.client_id = auth.uid() OR sb.professional_id = auth.uid())
      )
    )
  );

-- INSERT: only the professional can upload into their own folder
DROP POLICY IF EXISTS evidence_insert_own ON storage.objects;
CREATE POLICY evidence_insert_own ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'evidence'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

-- UPDATE/DELETE: the uploading professional or staff (evidence is otherwise immutable)
DROP POLICY IF EXISTS evidence_update_own ON storage.objects;
CREATE POLICY evidence_update_own ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'evidence'
    AND (auth.uid()::text = (storage.foldername(name))[2] OR is_staff(auth.uid()))
  );

DROP POLICY IF EXISTS evidence_delete_own ON storage.objects;
CREATE POLICY evidence_delete_own ON storage.objects
  FOR DELETE USING (
    bucket_id = 'evidence'
    AND (auth.uid()::text = (storage.foldername(name))[2] OR is_staff(auth.uid()))
  );
