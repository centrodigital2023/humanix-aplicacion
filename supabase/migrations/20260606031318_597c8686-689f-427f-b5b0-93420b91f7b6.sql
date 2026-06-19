
DROP POLICY IF EXISTS prof_select_map_public ON public.professional_profiles;
DROP POLICY IF EXISTS inst_select_map_public ON public.institution_profiles;

DROP VIEW IF EXISTS public.public_professionals_safe;
CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  user_id,
  specialty,
  sub_specialties,
  gender,
  years_experience,
  home_city,
  service_cities,
  hourly_rate,
  shift_rate,
  monthly_rate,
  avg_rating,
  total_jobs,
  trust_score,
  verified,
  rethus_verified,
  ai_summary,
  certifications,
  languages,
  availability,
  available,
  lat,
  lng,
  active,
  published,
  ai_preapproved,
  reserved_until,
  avatar_url
FROM public.professional_profiles
WHERE available = true
  AND published = true
  AND blocked = false;

GRANT SELECT ON public.public_professionals_safe TO authenticated, anon;

DROP VIEW IF EXISTS public.public_institutions_safe;
CREATE VIEW public.public_institutions_safe
WITH (security_invoker = false) AS
SELECT
  user_id,
  institution_name,
  institution_type,
  city,
  verified,
  lat,
  lng,
  visible_on_map,
  website
FROM public.institution_profiles
WHERE visible_on_map = true
  AND lat IS NOT NULL
  AND lng IS NOT NULL;

GRANT SELECT ON public.public_institutions_safe TO authenticated, anon;

DROP POLICY IF EXISTS ratings_select_all ON public.ratings;
CREATE POLICY ratings_select_authenticated
  ON public.ratings
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS pqrs_insert_anyone ON public.pqrs_tickets;
CREATE POLICY pqrs_insert_authenticated_self
  ON public.pqrs_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY pqrs_insert_anonymous
  ON public.pqrs_tickets
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);
