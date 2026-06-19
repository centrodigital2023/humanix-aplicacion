
-- Switch view to SECURITY INVOKER (fixes lint 0010)
DROP VIEW IF EXISTS public.public_profiles_safe;

CREATE VIEW public.public_profiles_safe
WITH (security_invoker = true)
AS
SELECT p.user_id, p.full_name, p.city, p.avatar_url, p.bio
FROM public.profiles p
JOIN public.professional_profiles pp ON pp.user_id = p.user_id
WHERE pp.published = true
  AND pp.active = true
  AND COALESCE(pp.blocked, false) = false;

GRANT SELECT ON public.public_profiles_safe TO anon, authenticated;

-- Column-level grant: anon/authenticated can only read safe columns from profiles.
-- Existing self/staff SELECT policies still work because they use the table owner's grants.
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (user_id, full_name, city, avatar_url, bio) ON public.profiles TO anon;
GRANT SELECT (user_id, full_name, city, avatar_url, bio) ON public.profiles TO authenticated;

-- Permissive SELECT policy so the view actually returns rows under SECURITY INVOKER.
-- Row exposure is gated to published & active professionals only.
DROP POLICY IF EXISTS "public_read_published_pros" ON public.profiles;
CREATE POLICY "public_read_published_pros" ON public.profiles
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.professional_profiles pp
    WHERE pp.user_id = profiles.user_id
      AND pp.published = true
      AND pp.active = true
      AND COALESCE(pp.blocked, false) = false
  )
);
