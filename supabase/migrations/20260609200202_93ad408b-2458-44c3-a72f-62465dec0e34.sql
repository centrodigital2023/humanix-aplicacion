-- 1) Tighten profiles counterpart visibility
DROP POLICY IF EXISTS profiles_select_involved_counterparts ON public.profiles;
CREATE POLICY profiles_select_involved_counterparts
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.job_offers o ON o.id = a.job_offer_id
    WHERE a.status = 'accepted'
      AND (
        (profiles.user_id = a.professional_id AND o.posted_by = auth.uid())
        OR (profiles.user_id = o.posted_by AND a.professional_id = auth.uid())
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.service_bookings b
    WHERE COALESCE(b.status,'') NOT IN ('cancelled','canceled','rejected')
      AND (
        (profiles.user_id = b.professional_id AND b.client_id = auth.uid())
        OR (profiles.user_id = b.client_id AND b.professional_id = auth.uid())
      )
  )
);

-- 2) Add interview_schedules topic auth to realtime policy
DROP POLICY IF EXISTS "realtime_topic_scoped" ON realtime.messages;
CREATE POLICY "realtime_topic_scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.is_staff(auth.uid())
    OR COALESCE(realtime.topic(), '') IN ('ads-realtime', 'buscar-realtime')
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
      AND split_part(realtime.topic(), '_', 3)::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^proposals_inbox_(professional|family|institution)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND split_part(realtime.topic(), '_', 4)::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^agenda_viewer_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(professional|family|institution)$'
      AND split_part(realtime.topic(), '_', 3)::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^family_needs_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_'
      AND split_part(realtime.topic(), '_', 3)::uuid = auth.uid()
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^open_needs_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND split_part(realtime.topic(), '_', 3)::uuid = auth.uid()
    )
  )
);