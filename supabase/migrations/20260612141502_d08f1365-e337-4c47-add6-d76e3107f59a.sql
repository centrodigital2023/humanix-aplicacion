-- Backfill family_profiles para familias sin perfil
INSERT INTO public.family_profiles (user_id)
SELECT ur.user_id FROM public.user_roles ur
WHERE ur.role = 'family'
  AND NOT EXISTS (SELECT 1 FROM public.family_profiles fp WHERE fp.user_id = ur.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- Backfill institution_profiles
INSERT INTO public.institution_profiles (user_id, institution_name)
SELECT ur.user_id, COALESCE(pr.full_name, 'Institución')
FROM public.user_roles ur
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
WHERE ur.role = 'institution'
  AND NOT EXISTS (SELECT 1 FROM public.institution_profiles ip WHERE ip.user_id = ur.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- Vista profesionales con full_name y phone
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe WITH (security_barrier = true) AS
SELECT ur.user_id, pp.lat, pp.lng,
  (pp.lat IS NOT NULL AND pp.lng IS NOT NULL) AS has_exact_location,
  pp.specialty, pp.sub_specialties, pp.gender, pp.years_experience, pp.home_city,
  pp.service_cities, pp.hourly_rate, pp.shift_rate, pp.monthly_rate, pp.avg_rating,
  pp.total_jobs, pp.trust_score, pp.verified, pp.rethus_verified, pp.ai_summary,
  pp.ai_strengths, pp.certifications, pp.work_experience, pp.languages, pp.availability,
  COALESCE(pp.available, FALSE) AS available,
  CASE WHEN COALESCE(pp.reserved_until > now(), FALSE) THEN 'busy'
       WHEN pp.available = TRUE THEN 'available'
       ELSE 'unavailable' END AS availability_status,
  pp.active, pp.published, pp.ai_preapproved, pp.reserved_until,
  COALESCE(pp.avatar_url, pr.avatar_url) AS avatar_url, pp.bio,
  COALESCE(pr.full_name, 'Profesional') AS full_name, pr.phone
FROM public.user_roles ur
LEFT JOIN public.professional_profiles pp ON pp.user_id = ur.user_id
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
WHERE ur.role = 'professional' AND COALESCE(pp.active, TRUE) IS NOT FALSE;
GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- Vista familias con full_name y phone
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe WITH (security_barrier = true) AS
SELECT ur.user_id, fp.default_lat, fp.default_lng,
  (fp.default_lat IS NOT NULL AND fp.default_lng IS NOT NULL) AS has_exact_location,
  COALESCE(fp.patient_name, pr.full_name, 'Familia') AS patient_name,
  COALESCE(fp.default_address, pr.city) AS default_address,
  COALESCE(fp.visible_on_map, TRUE) AS visible_on_map,
  COALESCE(fp.whatsapp, pr.phone) AS whatsapp,
  COALESCE(pr.full_name, 'Familia') AS full_name,
  COALESCE(pr.avatar_url, '') AS avatar_url, pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
LEFT JOIN public.family_profiles fp ON fp.user_id = ur.user_id
WHERE ur.role = 'family';
GRANT SELECT ON public.public_family_map_safe TO anon, authenticated;

-- Vista instituciones con full_name y phone
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe WITH (security_barrier = true) AS
SELECT ur.user_id, ip.lat, ip.lng,
  (ip.lat IS NOT NULL AND ip.lng IS NOT NULL) AS has_exact_location,
  COALESCE(ip.institution_name, pr.full_name, 'Institución') AS institution_name,
  COALESCE(ip.city, pr.city) AS city, ip.address,
  COALESCE(ip.institution_type, 'otro') AS institution_type,
  COALESCE(ip.visible_on_map, TRUE) AS visible_on_map,
  COALESCE(pr.full_name, ip.institution_name, 'Institución') AS full_name,
  COALESCE(pr.avatar_url, '') AS avatar_url, pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
LEFT JOIN public.institution_profiles ip ON ip.user_id = ur.user_id
WHERE ur.role = 'institution';
GRANT SELECT ON public.public_institutions_safe TO anon, authenticated;