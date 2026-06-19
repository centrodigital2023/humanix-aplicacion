-- Mostrar TODOS los registrados en el mapa, no solo quienes tienen GPS.
-- Usuarios sin GPS exacto → el frontend usa ciudad como fallback (Bogotá si no hay ciudad).
-- Se añade has_exact_location para que el mapa muestre un marcador diferente.

-- ─── FAMILIES: mostrar todas, con o sin GPS ───────────────────────────────────
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT
  fp.user_id,
  fp.default_lat,
  fp.default_lng,
  (fp.default_lat IS NOT NULL AND fp.default_lng IS NOT NULL) AS has_exact_location,
  fp.patient_name,
  fp.patient_relation,
  fp.default_address,
  fp.visible_on_map,
  fp.whatsapp,
  pr.full_name,
  pr.avatar_url,
  pr.phone
FROM public.family_profiles fp
LEFT JOIN public.profiles pr ON pr.user_id = fp.user_id;

GRANT SELECT ON public.public_family_map_safe TO authenticated, anon;

-- ─── INSTITUTIONS: mostrar todas, con o sin GPS ───────────────────────────────
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_invoker = false) AS
SELECT
  ip.user_id,
  ip.institution_name,
  ip.institution_type,
  ip.city,
  ip.verified,
  ip.lat,
  ip.lng,
  (ip.lat IS NOT NULL AND ip.lng IS NOT NULL) AS has_exact_location,
  ip.visible_on_map,
  ip.website,
  pr.full_name,
  pr.avatar_url,
  pr.phone
FROM public.institution_profiles ip
LEFT JOIN public.profiles pr ON pr.user_id = ip.user_id;

GRANT SELECT ON public.public_institutions_safe TO authenticated, anon;

-- ─── PROFESSIONALS: ya no filtra por GPS en la vista ─────────────────────────
-- (el filtro anterior era en el query del frontend, no en la vista)
-- Se añade has_exact_location para consistencia.
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  pp.user_id,
  pp.specialty,
  pp.sub_specialties,
  pp.gender,
  pp.years_experience,
  pp.home_city,
  pp.service_cities,
  pp.hourly_rate,
  pp.shift_rate,
  pp.monthly_rate,
  pp.avg_rating,
  pp.total_jobs,
  pp.trust_score,
  pp.verified,
  pp.rethus_verified,
  pp.rethus_number,
  pp.ai_summary,
  pp.ai_strengths,
  pp.certifications,
  pp.work_experience,
  pp.languages,
  pp.availability,
  pp.available,
  pp.lat,
  pp.lng,
  (pp.lat IS NOT NULL AND pp.lng IS NOT NULL) AS has_exact_location,
  pp.active,
  pp.published,
  pp.ai_preapproved,
  pp.reserved_until,
  pp.avatar_url,
  pp.bio,
  pp.blocked,
  pr.full_name,
  pr.phone,
  CASE WHEN pp.available = TRUE THEN 'available' ELSE 'unavailable' END AS availability_status
FROM public.professional_profiles pp
LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
WHERE pp.blocked IS NOT TRUE;

GRANT SELECT ON public.public_professionals_safe TO authenticated, anon;
