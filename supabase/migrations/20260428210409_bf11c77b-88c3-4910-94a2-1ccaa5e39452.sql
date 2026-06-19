
-- 1) messages: drop the permissive realtime policy that bypasses participant scoping
DROP POLICY IF EXISTS "realtime_authenticated_only" ON public.messages;

-- 2) professional_profiles: restrict public SELECT
-- Drop the overly permissive policy and replace with safer scoping.
DROP POLICY IF EXISTS "pro_select_all" ON public.professional_profiles;

-- Owners and staff can always read full row (already covered by pro_staff_all for staff).
CREATE POLICY "pro_select_owner"
ON public.professional_profiles
FOR SELECT
USING (auth.uid() = user_id);

-- Authenticated users can read profiles (still excludes anonymous scrapers).
-- Sensitive fields are filtered via the public view below.
CREATE POLICY "pro_select_authenticated"
ON public.professional_profiles
FOR SELECT
TO authenticated
USING (true);

-- Public-safe view that excludes precise GPS, internal moderation/AI fields,
-- and other sensitive columns. Use this for unauthenticated/listing reads.
CREATE OR REPLACE VIEW public.professional_profiles_public AS
SELECT
  id,
  user_id,
  specialty,
  sub_specialties,
  years_experience,
  rethus_verified,
  certifications,
  hourly_rate,
  shift_rate,
  monthly_rate,
  availability,
  total_jobs,
  avg_rating,
  avatar_url,
  bio,
  work_experience,
  home_city,
  service_cities,
  languages,
  trust_score,
  ai_summary,
  ai_strengths,
  verified,
  active,
  available,
  published,
  published_at,
  created_at,
  updated_at
FROM public.professional_profiles
WHERE COALESCE(blocked, false) = false
  AND COALESCE(active, true) = true;

GRANT SELECT ON public.professional_profiles_public TO anon, authenticated;

-- 3) Lock down SECURITY DEFINER helper functions that should not be publicly executable.
-- Keep has_role/is_staff callable (used inside RLS as auth.uid() check is fine but
-- they're invoked by policies internally; revoke direct anon EXECUTE).
REVOKE EXECUTE ON FUNCTION public.set_offer_reserved(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_expired_reservations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_get_profile(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_staff_invitation(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_audit(text, text, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_professionals_for_offer(uuid, integer, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_offers_for_professional(uuid, integer, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM anon;
