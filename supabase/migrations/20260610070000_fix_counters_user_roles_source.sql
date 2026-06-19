-- ═══════════════════════════════════════════════════════════════════════════
-- Fix: contadores y vistas del mapa usando user_roles como fuente de verdad.
--
-- Problema raíz:
--   • family_profiles / institution_profiles no existen en este DB.
--   • job_offers no tiene columnas lat/lng → las vistas previas fallaban.
--   • get_platform_counts contaba desde job_offers, ignorando usuarios que
--     se registraron pero nunca publicaron una oferta.
--
-- Solución:
--   • Las tres vistas del mapa parten de user_roles (fuente real de registro).
--   • LEFT JOIN con professional_profiles / profiles para datos de perfil.
--   • get_platform_counts cuenta desde user_roles → total real = usuarios
--     registrados con ese rol, sin importar si completaron su perfil.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. public_professionals_safe ────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_invoker = false) AS
SELECT
  ur.user_id,
  pp.lat,
  pp.lng,
  (pp.lat IS NOT NULL AND pp.lng IS NOT NULL)                 AS has_exact_location,
  pp.specialty,
  pp.sub_specialties,
  pp.gender,
  pp.years_experience,
  pp.home_city,
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
  COALESCE(pp.available, FALSE)                               AS available,
  CASE WHEN pp.available = TRUE THEN 'available' ELSE 'unavailable' END AS availability_status,
  pp.active,
  pp.published,
  pp.ai_preapproved,
  pp.reserved_until,
  pp.blocked,
  COALESCE(pp.avatar_url, pr.avatar_url)                      AS avatar_url,
  pp.bio,
  COALESCE(pr.full_name, 'Profesional')                       AS full_name,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.professional_profiles pp ON pp.user_id = ur.user_id
LEFT JOIN public.profiles pr              ON pr.user_id = ur.user_id
WHERE ur.role = 'professional'
  AND COALESCE(pp.blocked, FALSE) = FALSE;

GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- ─── 2. public_family_map_safe ────────────────────────────────────────────────
-- Familias: toda persona registrada con role='family'.
-- Ubicación: si publicaron una oferta de trabajo se usa la ciudad de la oferta;
-- si no, el mapa usa la ciudad del perfil como fallback (cityToLatLng en el FE).
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_invoker = false) AS
SELECT
  ur.user_id,
  NULL::double precision                                      AS default_lat,
  NULL::double precision                                      AS default_lng,
  FALSE                                                       AS has_exact_location,
  COALESCE(jo.title, 'Familia')                               AS patient_name,
  COALESCE(jo.city, pr.city)                                  AS default_address,
  TRUE                                                        AS visible_on_map,
  pr.phone                                                    AS whatsapp,
  COALESCE(pr.full_name, 'Familia')                           AS full_name,
  COALESCE(pr.avatar_url, '')                                 AS avatar_url,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
LEFT JOIN LATERAL (
  SELECT title, city
  FROM   public.job_offers
  WHERE  posted_by = ur.user_id
    AND  poster_type = 'family'
  ORDER  BY created_at DESC
  LIMIT  1
) jo ON true
WHERE ur.role = 'family';

GRANT SELECT ON public.public_family_map_safe TO anon, authenticated;

-- ─── 3. public_institutions_safe ─────────────────────────────────────────────
-- Instituciones: toda persona registrada con role='institution'.
-- Ubicación: ciudad de la oferta más reciente (el FE geocodifica con cityToLatLng).
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_invoker = false) AS
SELECT
  ur.user_id,
  NULL::double precision                                      AS lat,
  NULL::double precision                                      AS lng,
  FALSE                                                       AS has_exact_location,
  COALESCE(jo.title, pr.full_name, 'Institución')             AS institution_name,
  COALESCE(jo.city, pr.city)                                  AS city,
  jo.address,
  'otro'                                                      AS institution_type,
  TRUE                                                        AS visible_on_map,
  COALESCE(pr.full_name, 'Institución')                       AS full_name,
  COALESCE(pr.avatar_url, '')                                 AS avatar_url,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
LEFT JOIN LATERAL (
  SELECT title, city, address
  FROM   public.job_offers
  WHERE  posted_by = ur.user_id
    AND  poster_type = 'institution'
  ORDER  BY created_at DESC
  LIMIT  1
) jo ON true
WHERE ur.role = 'institution';

GRANT SELECT ON public.public_institutions_safe TO anon, authenticated;

-- ─── 4. get_platform_counts ───────────────────────────────────────────────────
-- Cuenta desde user_roles → total real de usuarios registrados por rol.
DROP FUNCTION IF EXISTS public.get_platform_counts() CASCADE;

CREATE OR REPLACE FUNCTION public.get_platform_counts()
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT ur.user_id)
       FROM public.user_roles ur
      WHERE ur.role = 'professional')                                          AS professionals_total,

    (SELECT COUNT(*)
       FROM public.professional_profiles pp
      WHERE pp.available = TRUE
        AND COALESCE(pp.blocked, FALSE) = FALSE)                               AS professionals_available,

    (SELECT COUNT(*)
       FROM public.professional_profiles pp
      WHERE pp.rethus_verified = TRUE
        AND COALESCE(pp.blocked, FALSE) = FALSE)                               AS professionals_rethus,

    (SELECT COUNT(DISTINCT ul.user_id)
       FROM public.user_locations ul
       JOIN public.user_roles ur ON ur.user_id = ul.user_id
      WHERE ul.is_online = TRUE
        AND ur.role = 'professional')                                          AS professionals_online,

    (SELECT COUNT(DISTINCT ur.user_id)
       FROM public.user_roles ur
      WHERE ur.role = 'family')                                                AS families_total,

    (SELECT COUNT(DISTINCT ul.user_id)
       FROM public.user_locations ul
       JOIN public.user_roles ur ON ur.user_id = ul.user_id
      WHERE ul.is_online = TRUE
        AND ur.role = 'family')                                                AS families_online,

    (SELECT COUNT(DISTINCT ur.user_id)
       FROM public.user_roles ur
      WHERE ur.role = 'institution')                                           AS institutions_total,

    (SELECT COUNT(DISTINCT ul.user_id)
       FROM public.user_locations ul
       JOIN public.user_roles ur ON ur.user_id = ul.user_id
      WHERE ul.is_online = TRUE
        AND ur.role = 'institution')                                           AS institutions_online,

    (SELECT COUNT(*)
       FROM public.service_bookings
      WHERE status = 'completed')                                              AS completed_services;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;
