-- Enriquecer las vistas del mapa con datos de profiles (nombre, avatar, teléfono)
-- mediante SQL JOIN en la vista (security_invoker=false → bypasa RLS).
-- Esto elimina la necesidad del FK-embedding profiles:user_id(...) en PostgREST
-- que falla silenciosamente en vistas (las vistas no tienen FK relationships).

-- ─── PROFESSIONALS ────────────────────────────────────────────────────────────
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
  pp.ai_summary,
  pp.certifications,
  pp.languages,
  pp.availability,
  pp.available,
  pp.lat,
  pp.lng,
  pp.active,
  pp.published,
  pp.ai_preapproved,
  pp.reserved_until,
  pp.avatar_url,
  pp.bio,
  pp.blocked,
  -- Datos de profiles incluidos en la vista
  pr.full_name,
  pr.phone,
  CASE WHEN pp.available = TRUE THEN 'available' ELSE 'unavailable' END AS availability_status
FROM public.professional_profiles pp
LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
WHERE pp.blocked IS NOT TRUE;

GRANT SELECT ON public.public_professionals_safe TO authenticated, anon;

-- ─── FAMILIES ─────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT
  fp.user_id,
  fp.default_lat,
  fp.default_lng,
  fp.patient_name,
  fp.patient_relation,
  fp.default_address,
  fp.visible_on_map,
  fp.whatsapp,
  -- Datos de profiles incluidos en la vista
  pr.full_name,
  pr.avatar_url,
  pr.phone
FROM public.family_profiles fp
LEFT JOIN public.profiles pr ON pr.user_id = fp.user_id
WHERE fp.default_lat IS NOT NULL
  AND fp.default_lng IS NOT NULL;

GRANT SELECT ON public.public_family_map_safe TO authenticated, anon;

-- ─── INSTITUTIONS ─────────────────────────────────────────────────────────────
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
  ip.visible_on_map,
  ip.website,
  -- Datos de profiles incluidos en la vista
  pr.full_name,
  pr.avatar_url,
  pr.phone
FROM public.institution_profiles ip
LEFT JOIN public.profiles pr ON pr.user_id = ip.user_id
WHERE ip.lat IS NOT NULL
  AND ip.lng IS NOT NULL;

GRANT SELECT ON public.public_institutions_safe TO authenticated, anon;
