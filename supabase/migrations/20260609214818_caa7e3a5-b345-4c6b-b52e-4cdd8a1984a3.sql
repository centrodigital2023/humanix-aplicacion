DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;

CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  user_id, specialty, sub_specialties, gender, years_experience, home_city,
  service_cities, hourly_rate, shift_rate, monthly_rate, avg_rating, total_jobs,
  trust_score, verified, rethus_verified, ai_summary, certifications, languages,
  availability,
  CASE WHEN available = true THEN 'available' ELSE 'unavailable' END AS availability_status,
  available, lat, lng, active, published, ai_preapproved, reserved_until, avatar_url
FROM public.professional_profiles
WHERE blocked = false;

GRANT SELECT ON public.public_professionals_safe TO authenticated, anon;

DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;

CREATE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT fp.user_id, fp.default_lat, fp.default_lng, fp.patient_name,
  fp.patient_relation, fp.default_address, fp.visible_on_map, fp.whatsapp
FROM public.family_profiles fp
WHERE fp.default_lat IS NOT NULL AND fp.default_lng IS NOT NULL;

GRANT SELECT ON public.public_family_map_safe TO authenticated, anon;

DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;

CREATE VIEW public.public_institutions_safe
WITH (security_invoker = false) AS
SELECT user_id, institution_name, institution_type, city, verified,
  lat, lng, visible_on_map, website
FROM public.institution_profiles
WHERE lat IS NOT NULL AND lng IS NOT NULL;

GRANT SELECT ON public.public_institutions_safe TO authenticated, anon;