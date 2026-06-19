-- ═══════════════════════════════════════════════════════════════════════════
-- Corregir vistas del mapa para que coincidan con el esquema real de producción.
-- Familias e Instituciones vienen de job_offers (poster_type = 'family'/'institution'),
-- no de family_profiles/institution_profiles que no existen en esta BD.
-- Se añaden las columnas que espera el frontend: has_exact_location, full_name,
-- avatar_url, phone, visible_on_map, patient_name, etc.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Profesionales: añadir JOIN a profiles para full_name y phone ──────────
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  pp.user_id,
  pp.specialty,
  pp.sub_specialties,
  pp.years_experience,
  pp.rethus_number,
  pp.rethus_verified,
  pp.certifications,
  pp.hourly_rate,
  pp.shift_rate,
  pp.monthly_rate,
  pp.availability,
  pp.service_cities,
  pp.languages,
  pp.trust_score,
  pp.ai_summary,
  pp.ai_strengths,
  pp.verified,
  pp.active,
  pp.total_jobs,
  pp.avg_rating,
  COALESCE(pp.avatar_url, pr.avatar_url)                AS avatar_url,
  pp.bio,
  pp.work_experience,
  pp.ai_preapproved,
  pp.lat,
  pp.lng,
  (pp.lat IS NOT NULL AND pp.lng IS NOT NULL)           AS has_exact_location,
  pp.home_city,
  pp.available,
  pp.reserved_until,
  pp.published,
  CASE WHEN pp.available = TRUE THEN 'available' ELSE 'unavailable' END AS availability_status,
  COALESCE(pr.full_name, 'Profesional')                 AS full_name,
  pr.phone
FROM public.professional_profiles pp
LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
WHERE pp.active IS NOT FALSE;

GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- ── Familias: desde job_offers poster_type='family', columnas del frontend ─
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT
  jo.id,
  jo.posted_by                                          AS user_id,
  jo.title                                              AS patient_name,
  jo.city                                               AS default_address,
  jo.lat                                                AS default_lat,
  jo.lng                                                AS default_lng,
  (jo.lat IS NOT NULL AND jo.lng IS NOT NULL)           AS has_exact_location,
  TRUE                                                  AS visible_on_map,
  jo.status,
  jo.amount,
  jo.created_at,
  COALESCE(pr.full_name, 'Familia')                     AS full_name,
  COALESCE(pr.avatar_url, '')                           AS avatar_url,
  pr.phone,
  pr.phone                                              AS whatsapp
FROM public.job_offers jo
LEFT JOIN public.profiles pr ON pr.user_id = jo.posted_by
WHERE jo.poster_type = 'family';

GRANT SELECT ON public.public_family_map_safe TO anon, authenticated;

-- ── Instituciones: desde job_offers poster_type='institution' ─────────────
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_invoker = false) AS
SELECT
  jo.id,
  jo.posted_by                                          AS user_id,
  jo.title                                              AS institution_name,
  jo.city,
  jo.address,
  jo.lat,
  jo.lng,
  (jo.lat IS NOT NULL AND jo.lng IS NOT NULL)           AS has_exact_location,
  TRUE                                                  AS visible_on_map,
  'otro'                                                AS institution_type,
  jo.status,
  jo.amount,
  jo.created_at,
  COALESCE(pr.full_name, 'Institución')                 AS full_name,
  COALESCE(pr.avatar_url, '')                           AS avatar_url,
  pr.phone
FROM public.job_offers jo
LEFT JOIN public.profiles pr ON pr.user_id = jo.posted_by
WHERE jo.poster_type = 'institution';

GRANT SELECT ON public.public_institutions_safe TO anon, authenticated;

-- ── get_platform_counts: conteos correctos con job_offers ─────────────────
DROP FUNCTION IF EXISTS public.get_platform_counts() CASCADE;

CREATE FUNCTION public.get_platform_counts()
RETURNS TABLE(
  professionals_total     bigint,
  professionals_available bigint,
  professionals_rethus    bigint,
  professionals_online    bigint,
  families_total          bigint,
  families_online         bigint,
  institutions_total      bigint,
  institutions_online     bigint,
  completed_services      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*) FROM public.professional_profiles WHERE active IS NOT FALSE)
      AS professionals_total,
    (SELECT COUNT(*) FROM public.professional_profiles WHERE available = TRUE AND active IS NOT FALSE)
      AS professionals_available,
    (SELECT COUNT(*) FROM public.professional_profiles WHERE rethus_verified = TRUE AND active IS NOT FALSE)
      AS professionals_rethus,
    (SELECT COUNT(*) FROM public.user_locations ul
       JOIN public.professional_profiles pp ON pp.user_id = ul.user_id
      WHERE ul.is_online = TRUE AND pp.active IS NOT FALSE)
      AS professionals_online,
    (SELECT COUNT(DISTINCT posted_by) FROM public.job_offers WHERE poster_type = 'family')
      AS families_total,
    (SELECT COUNT(*) FROM public.user_locations ul
       JOIN public.job_offers jo ON jo.posted_by = ul.user_id
      WHERE ul.is_online = TRUE AND jo.poster_type = 'family')
      AS families_online,
    (SELECT COUNT(DISTINCT posted_by) FROM public.job_offers WHERE poster_type = 'institution')
      AS institutions_total,
    (SELECT COUNT(*) FROM public.user_locations ul
       JOIN public.job_offers jo ON jo.posted_by = ul.user_id
      WHERE ul.is_online = TRUE AND jo.poster_type = 'institution')
      AS institutions_online,
    (SELECT COUNT(*) FROM public.service_bookings WHERE status = 'completed')
      AS completed_services;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;
