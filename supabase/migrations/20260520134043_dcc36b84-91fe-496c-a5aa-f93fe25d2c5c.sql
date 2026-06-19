-- Harden public profile visibility: public rows stay discoverable, but sensitive columns are not grantable through the open policy.
DROP POLICY IF EXISTS "public_read_published_pros" ON public.profiles;
CREATE POLICY "public_read_published_pros"
ON public.profiles
FOR SELECT
TO anon, authenticated
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

REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (user_id, full_name, city, avatar_url, bio) ON public.profiles TO anon, authenticated;
GRANT SELECT (id, user_id, full_name, phone, city, avatar_url, bio, email, created_at, updated_at) ON public.profiles TO authenticated;

-- Harden open job offer visibility: keep marketplace listing fields readable, but do not expose contact_phone broadly.
REVOKE SELECT ON public.job_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, posted_by, poster_type, title, description, modality, amount, city, address,
  specialty_required, requirements, start_date, end_date, shifts_count, status,
  created_at, updated_at, lat, lng, reserved_until, blocked
) ON public.job_offers TO anon, authenticated;

-- Explicitly constrain role writes to superadmins only.
DROP POLICY IF EXISTS "user_roles_insert_superadmin_only" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_update_superadmin_only" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_delete_superadmin_only" ON public.user_roles;
CREATE POLICY "user_roles_insert_superadmin_only"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "user_roles_update_superadmin_only"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'))
WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "user_roles_delete_superadmin_only"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'superadmin'));

-- Tighten Realtime topic authorization for sensitive tables/channels.
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
    OR COALESCE(realtime.topic(), '') IN (
      'notif-' || auth.uid()::text,
      'family-docs-' || auth.uid()::text,
      'fam-profile-' || auth.uid()::text,
      'pro-dash-realtime-' || auth.uid()::text,
      'fam-dash-' || auth.uid()::text,
      'fam-pros-realtime-' || auth.uid()::text,
      'pending-ratings-' || auth.uid()::text,
      'mp_subscriptions:' || auth.uid()::text
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