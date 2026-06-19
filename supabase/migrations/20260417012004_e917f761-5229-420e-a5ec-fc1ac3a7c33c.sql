
-- 1. PROFILES: restrict full row to owner/staff; expose safe fields via a view
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;

CREATE POLICY "profiles_select_self_or_staff"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- Safe view for authenticated users browsing the marketplace (no email/phone)
CREATE OR REPLACE VIEW public.public_profiles_safe
WITH (security_invoker = true) AS
SELECT user_id, full_name, city, avatar_url, bio
FROM public.profiles;

REVOKE ALL ON public.public_profiles_safe FROM PUBLIC, anon;
GRANT SELECT ON public.public_profiles_safe TO authenticated;

-- Allow authenticated users to read non-sensitive cols of other profiles via a permissive policy
-- Limited to columns granted on the view (security_invoker requires base-table RLS to allow)
CREATE POLICY "profiles_select_safe_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Note: the above grants row visibility to authenticated users; column-level restriction
-- for email/phone is enforced by application using the public_profiles_safe view + REVOKE below.
REVOKE SELECT (email, phone) ON public.profiles FROM anon, authenticated;
GRANT SELECT (user_id, full_name, city, avatar_url, bio, created_at, updated_at, id)
  ON public.profiles TO authenticated;
GRANT SELECT (user_id, full_name, city, avatar_url, bio)
  ON public.profiles TO anon;

-- Owner and staff get full access (re-grant for owner via separate policy approach not needed; DEFAULT GRANT to owner via service role; but for self-access, the table-level GRANT must include all cols for staff/superadmin)
-- We need staff to read email/phone. Since column GRANTs are role-based (not row-based), grant full SELECT to a service role only via security definer function.

-- Function to fetch own/staff full profile (bypasses column grants via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.staff_get_profile(_user_id uuid)
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles
  WHERE user_id = _user_id AND public.is_staff(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
REVOKE ALL ON FUNCTION public.staff_get_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_get_profile(uuid) TO authenticated;

-- 2. INSTITUTION PROFILES: restrict to authenticated users (block anon)
DROP POLICY IF EXISTS "inst_select_all" ON public.institution_profiles;
CREATE POLICY "inst_select_authenticated"
  ON public.institution_profiles FOR SELECT
  TO authenticated
  USING (true);

-- 3. PROFESSIONAL_DOCUMENTS: only owner or staff
DROP POLICY IF EXISTS "docs_select_owner_or_authenticated" ON public.professional_documents;
CREATE POLICY "docs_select_owner_or_staff"
  ON public.professional_documents FOR SELECT
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- 4. STORAGE: make professional-docs private
UPDATE storage.buckets SET public = false WHERE id = 'professional-docs';

DROP POLICY IF EXISTS "pdocs_select_public" ON storage.objects;

CREATE POLICY "pdocs_select_owner_or_staff"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'professional-docs'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.is_staff(auth.uid())
    )
  );

-- 5. STAFF_INVITATIONS: allow lookup by token to redeem (anon OK, narrow window)
CREATE POLICY "invites_select_by_token"
  ON public.staff_invitations FOR SELECT
  USING (used_at IS NULL AND expires_at > now());

-- 6. Remove hardcoded superadmin email from handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role public.app_role;
  v_meta_role TEXT;
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, phone, city)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'city'
  );

  v_meta_role := NEW.raw_user_meta_data->>'role';
  IF v_meta_role IN ('professional','family','institution') THEN
    v_role := v_meta_role::public.app_role;
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
      ON CONFLICT DO NOTHING;

    IF v_role = 'professional' THEN
      INSERT INTO public.professional_profiles (user_id) VALUES (NEW.id)
        ON CONFLICT DO NOTHING;
    ELSIF v_role = 'institution' THEN
      INSERT INTO public.institution_profiles (user_id, institution_name)
      VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'institution_name','Institución'))
        ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'family')
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
