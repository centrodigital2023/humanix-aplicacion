
-- =====================================================================
-- Security fixes batch
-- =====================================================================

-- 1) Security Definer Views -> switch to security_invoker
ALTER VIEW public.public_family_map_safe    SET (security_invoker = true);
ALTER VIEW public.public_institutions_safe  SET (security_invoker = true);
ALTER VIEW public.public_professionals_safe SET (security_invoker = true);
ALTER VIEW public.public_family_map_safe    RESET (security_barrier);
ALTER VIEW public.public_institutions_safe  RESET (security_barrier);
ALTER VIEW public.public_professionals_safe RESET (security_barrier);

-- 2) Extension in public -> move pgvector to extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
ALTER EXTENSION vector SET SCHEMA extensions;

-- 3) Public bucket allows listing: public buckets serve via CDN without
--    needing storage.objects SELECT. Drop broad SELECT policies so anon
--    cannot enumerate (list) bucket contents.
DROP POLICY IF EXISTS "avatars_select_public" ON storage.objects;
DROP POLICY IF EXISTS "ad_banners_public_read" ON storage.objects;

-- 4) SECURITY DEFINER functions executable by anon/authenticated:
--    Trigger-only / cron-only functions should not be exposed via the API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_free_subscription()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_conversation_last_message()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.community_testimonials_autopublish()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_platform_fee()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_conversation_on_accept()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_professional_publish()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_pro_avg_rating()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_wearable_connections_updated_at()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_expired_reservations()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column()                 FROM PUBLIC, anon, authenticated;

-- 5) ai_credits_ledger: add explicit INSERT policy bound to auth.uid()
CREATE POLICY "aic_insert_self"
  ON public.ai_credits_ledger
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 6) professional_profiles: allow public SELECT on published profiles
CREATE POLICY "pro_select_published_public"
  ON public.professional_profiles
  FOR SELECT TO anon, authenticated
  USING (
    COALESCE(published, false) = true
    AND COALESCE(active, true) = true
    AND COALESCE(blocked, false) = false
  );

-- 7) professional_references: restrict SELECT to owner + hr_staff/superadmin
--    (evaluators no longer see raw phone numbers).
DROP POLICY IF EXISTS "refs_select_owner_or_staff" ON public.professional_references;
CREATE POLICY "refs_select_owner_or_hr"
  ON public.professional_references
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'hr_staff')
    OR public.has_role(auth.uid(), 'superadmin')
  );

-- 8) service_bookings: prevent non-staff participants from mutating
--    financial fields. Use a BEFORE UPDATE trigger that resets protected
--    columns to OLD values when the caller is not staff.
CREATE OR REPLACE FUNCTION public.guard_service_bookings_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Financial / pricing fields: only staff may change.
  NEW.total_amount         := OLD.total_amount;
  NEW.hourly_rate          := OLD.hourly_rate;
  NEW.platform_fee_amount  := OLD.platform_fee_amount;
  NEW.platform_fee_pct     := OLD.platform_fee_pct;
  NEW.professional_payout  := OLD.professional_payout;
  NEW.payment_mode         := OLD.payment_mode;

  -- Identity fields must not be re-pointed by participants.
  NEW.client_id            := OLD.client_id;
  NEW.professional_id      := OLD.professional_id;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_service_bookings_financials() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_service_bookings_financials ON public.service_bookings;
CREATE TRIGGER trg_guard_service_bookings_financials
  BEFORE UPDATE ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_service_bookings_financials();
