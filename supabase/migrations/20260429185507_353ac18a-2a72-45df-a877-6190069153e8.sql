-- Restrict public job-offer reads so anonymous users cannot read contact_phone
DROP POLICY IF EXISTS "offers_select_open_or_owner" ON public.job_offers;
DROP POLICY IF EXISTS "offers_select_open_authenticated_or_owner" ON public.job_offers;

CREATE POLICY "offers_select_open_authenticated_or_owner"
ON public.job_offers
FOR SELECT
TO authenticated
USING (
  status = 'open'::offer_status
  OR posted_by = auth.uid()
  OR public.is_staff(auth.uid())
);

-- Defense-in-depth: anonymous clients may only request public-safe offer columns.
REVOKE SELECT ON public.job_offers FROM anon;
GRANT SELECT (
  id,
  title,
  description,
  modality,
  amount,
  city,
  specialty_required,
  requirements,
  poster_type,
  status,
  reserved_until,
  lat,
  lng,
  created_at
) ON public.job_offers TO anon;

-- Remove permissive message policies that bypass participant scoping.
DROP POLICY IF EXISTS "realtime_authenticated_only" ON public.messages;
DROP POLICY IF EXISTS "realtime_authenticated_only" ON realtime.messages;
DROP POLICY IF EXISTS "realtime_topic_scoped" ON realtime.messages;

ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "realtime_topic_scoped"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    public.is_staff(auth.uid())
    OR COALESCE(realtime.topic(), '') IN ('ads-realtime', 'buscar-realtime')
    OR COALESCE(realtime.topic(), '') LIKE ('%' || auth.uid()::text || '%')
    OR (
      COALESCE(realtime.topic(), '') ~ '^(messages|chat):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id = split_part(realtime.topic(), ':', 2)::uuid
          AND (c.poster_id = auth.uid() OR c.professional_id = auth.uid())
      )
    )
    OR (
      COALESCE(realtime.topic(), '') ~ '^(booking|tracking):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1
        FROM public.service_bookings b
        WHERE b.id = split_part(realtime.topic(), ':', 2)::uuid
          AND (b.client_id = auth.uid() OR b.professional_id = auth.uid())
      )
    )
  )
);