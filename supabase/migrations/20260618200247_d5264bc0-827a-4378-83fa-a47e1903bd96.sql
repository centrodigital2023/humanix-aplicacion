DROP POLICY IF EXISTS "realtime_topic_scoped" ON realtime.messages;
CREATE POLICY "realtime_topic_scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.is_staff(auth.uid())
    OR COALESCE(realtime.topic(), '') = 'buscar-realtime'
    OR (
      COALESCE(realtime.topic(), '') ~ '^(messages|chat):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = split_part(realtime.topic(), ':', 2)::uuid
          AND (c.poster_id = auth.uid() OR c.professional_id = auth.uid())
      )
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^(booking|tracking):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.service_bookings b
        WHERE b.id = split_part(realtime.topic(), ':', 2)::uuid
          AND (b.client_id = auth.uid() OR b.professional_id = auth.uid())
      )
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^interview:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM public.interview_schedules i
        WHERE i.id = split_part(realtime.topic(), ':', 2)::uuid
          AND (i.professional_id = auth.uid() OR i.scheduled_by = auth.uid())
      )
    )
    OR COALESCE(realtime.topic(), '') IN (
      'notif-' || auth.uid()::text,
      'family-docs-' || auth.uid()::text,
      'fam-profile-' || auth.uid()::text,
      'pro-dash-realtime-' || auth.uid()::text,
      'fam-dash-' || auth.uid()::text,
      'fam-pros-realtime-' || auth.uid()::text,
      'pending-ratings-' || auth.uid()::text,
      'mp_subscriptions:' || auth.uid()::text,
      'interview-' || auth.uid()::text
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^trust_profile_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(professional|family|institution)$'
      AND substring(realtime.topic() from '^trust_profile_([0-9a-f-]{36})_')::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^proposals_inbox_(professional|family|institution)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND substring(realtime.topic() from '_([0-9a-f-]{36})$')::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^agenda_viewer_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(professional|family|institution)$'
      AND substring(realtime.topic() from '^agenda_viewer_([0-9a-f-]{36})_')::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^family_needs_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_'
      AND substring(realtime.topic() from '^family_needs_([0-9a-f-]{36})_')::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^open_needs_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND substring(realtime.topic() from '^open_needs_([0-9a-f-]{36})$')::uuid = auth.uid()
    )
  )
);