DROP POLICY IF EXISTS "public_read_published_pros" ON public.profiles;
CREATE POLICY "public_read_published_pros"
ON public.profiles
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.professional_profiles pp
    WHERE pp.user_id = profiles.user_id
      AND pp.published = true
      AND pp.active = true
      AND COALESCE(pp.blocked, false) = false
  )
);

DROP POLICY IF EXISTS "profiles_select_involved_counterparts" ON public.profiles;
CREATE POLICY "profiles_select_involved_counterparts"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.applications a
    JOIN public.job_offers o ON o.id = a.job_offer_id
    WHERE (
      profiles.user_id = a.professional_id
      AND o.posted_by = auth.uid()
    ) OR (
      profiles.user_id = o.posted_by
      AND a.professional_id = auth.uid()
    )
  )
  OR EXISTS (
    SELECT 1
    FROM public.service_bookings b
    WHERE (
      profiles.user_id = b.professional_id
      AND b.client_id = auth.uid()
    ) OR (
      profiles.user_id = b.client_id
      AND b.professional_id = auth.uid()
    )
  )
);