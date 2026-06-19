
-- =============================================================================
-- 1) RATING-VOICE BUCKET: make private + scope access to participants/staff
-- =============================================================================
UPDATE storage.buckets SET public = false WHERE id = 'rating-voice';

-- Drop any existing public-read policy on rating-voice objects
DROP POLICY IF EXISTS "rating_voice_public_read" ON storage.objects;
DROP POLICY IF EXISTS "rating_voice_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "rating_voice_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "rating_voice_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "rating_voice_select_participants" ON storage.objects;
DROP POLICY IF EXISTS "rating_voice_insert_self" ON storage.objects;

-- Uploaders may write only inside their own user-id folder
CREATE POLICY "rating_voice_insert_self"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'rating-voice'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Reads: rater, rated professional, and staff
-- The path layout is: <userId>/<bookingId>-<ts>.webm
-- The first folder is the rater's user id; the rated user id is found via
-- the service_ratings row whose voice_url ends with this object name.
CREATE POLICY "rating_voice_select_participants"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'rating-voice'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.is_staff(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.service_ratings sr
        WHERE sr.voice_url LIKE '%' || name
          AND (sr.rated_id = auth.uid() OR sr.rater_id = auth.uid())
      )
    )
  );

-- =============================================================================
-- 2) PROFESSIONAL_PROFILES: hide sensitive columns from anonymous visitors
-- The pro_select_all policy stays (USING true) so the marketplace keeps working,
-- but column-level privileges revoke sensitive fields from the `anon` role.
-- Authenticated users keep access (RLS still applies row-by-row).
-- =============================================================================
REVOKE SELECT (
  lat,
  lng,
  blocked_reason,
  blocked_by,
  blocked_at,
  social_trust_breakdown,
  rethus_number
) ON public.professional_profiles FROM anon;

-- =============================================================================
-- 3) REALTIME.MESSAGES: require an authenticated user to subscribe
-- =============================================================================
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "realtime_authenticated_only" ON realtime.messages;

CREATE POLICY "realtime_authenticated_only"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (true);
