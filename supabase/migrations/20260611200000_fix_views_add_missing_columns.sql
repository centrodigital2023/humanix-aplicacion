-- ═══════════════════════════════════════════════════════════════════════════
-- Humanix: corregir vistas del mapa y crear get_platform_counts.
--
-- Problema raíz en proyecto rwllmouomrytejtbpxvn:
--  • public_professionals_safe: falta full_name, phone, has_exact_location,
--    bio, work_experience, ai_strengths → LiveMarketplaceMap falla con error 42703
--  • public_family_map_safe: falta has_exact_location, full_name, avatar_url, phone
--  • public_institutions_safe: falta has_exact_location, full_name, avatar_url, phone
--  • get_platform_counts: no existe → useActiveUsersCount cae al fallback de vistas
--    (counters sí funcionan pero sin la función la consistencia es menor)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. public_professionals_safe ────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_barrier = true) AS
SELECT
  pp.user_id,
  pp.lat,
  pp.lng,
  (pp.lat IS NOT NULL AND pp.lng IS NOT NULL)   AS has_exact_location,
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
  pp.ai_strengths,
  pp.certifications,
  pp.work_experience,
  pp.languages,
  pp.availability,
  COALESCE(pp.available, FALSE)                 AS available,
  CASE
    WHEN COALESCE(pp.reserved_until > now(), FALSE) THEN 'busy'
    WHEN pp.available = TRUE                         THEN 'available'
    ELSE                                                  'unavailable'
  END                                           AS availability_status,
  pp.active,
  pp.published,
  pp.ai_preapproved,
  pp.reserved_until,
  COALESCE(pp.avatar_url, pr.avatar_url)        AS avatar_url,
  pp.bio,
  COALESCE(pr.full_name, 'Profesional')         AS full_name,
  pr.phone
FROM public.professional_profiles pp
LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
WHERE COALESCE(pp.active, TRUE) IS NOT FALSE;

GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- ─── 2. public_family_map_safe ────────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_barrier = true) AS
SELECT
  fp.user_id,
  fp.default_lat,
  fp.default_lng,
  (fp.default_lat IS NOT NULL AND fp.default_lng IS NOT NULL) AS has_exact_location,
  COALESCE(jo.title, fp.patient_name, 'Familia')              AS patient_name,
  COALESCE(fp.default_address, jo.city, pr.city)              AS default_address,
  COALESCE(fp.visible_on_map, TRUE)                           AS visible_on_map,
  COALESCE(fp.whatsapp, pr.phone)                             AS whatsapp,
  COALESCE(pr.full_name, 'Familia')                           AS full_name,
  COALESCE(pr.avatar_url, '')                                 AS avatar_url,
  pr.phone
FROM public.family_profiles fp
LEFT JOIN public.profiles pr ON pr.user_id = fp.user_id
LEFT JOIN LATERAL (
  SELECT title, city
  FROM   public.job_offers
  WHERE  posted_by   = fp.user_id
    AND  poster_type = 'family'
  ORDER  BY created_at DESC
  LIMIT  1
) jo ON true;

GRANT SELECT ON public.public_family_map_safe TO anon, authenticated;

-- ─── 3. public_institutions_safe ─────────────────────────────────────────────
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_barrier = true) AS
SELECT
  ip.user_id,
  ip.lat,
  ip.lng,
  (ip.lat IS NOT NULL AND ip.lng IS NOT NULL)                  AS has_exact_location,
  COALESCE(ip.institution_name, pr.full_name, 'Institución')   AS institution_name,
  COALESCE(ip.city, jo.city, pr.city)                          AS city,
  COALESCE(ip.address, jo.address)                             AS address,
  COALESCE(ip.institution_type, 'otro')                        AS institution_type,
  COALESCE(ip.visible_on_map, TRUE)                            AS visible_on_map,
  COALESCE(pr.full_name, ip.institution_name, 'Institución')   AS full_name,
  COALESCE(pr.avatar_url, '')                                  AS avatar_url,
  pr.phone
FROM public.institution_profiles ip
LEFT JOIN public.profiles pr ON pr.user_id = ip.user_id
LEFT JOIN LATERAL (
  SELECT title, city, address
  FROM   public.job_offers
  WHERE  posted_by   = ip.user_id
    AND  poster_type = 'institution'
  ORDER  BY created_at DESC
  LIMIT  1
) jo ON true;

GRANT SELECT ON public.public_institutions_safe TO anon, authenticated;

-- ─── 4. get_platform_counts ───────────────────────────────────────────────────
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH
pro_stats AS (
  SELECT
    COUNT(*)                                          AS total,
    COUNT(*) FILTER (WHERE available = TRUE
      AND COALESCE(active, TRUE) IS NOT FALSE)        AS available,
    COUNT(*) FILTER (WHERE rethus_verified = TRUE)    AS rethus
  FROM public.professional_profiles
),
fam_stats AS (
  SELECT COUNT(*) AS total FROM public.family_profiles
),
inst_stats AS (
  SELECT COUNT(*) AS total FROM public.institution_profiles
),
online_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE ur.role = 'professional' AND ul.is_online = TRUE) AS pros_online,
    COUNT(*) FILTER (WHERE ur.role = 'family'       AND ul.is_online = TRUE) AS fam_online,
    COUNT(*) FILTER (WHERE ur.role = 'institution'  AND ul.is_online = TRUE) AS inst_online
  FROM public.user_locations ul
  JOIN public.user_roles ur ON ur.user_id = ul.user_id
),
svc AS (
  SELECT COUNT(*) AS completed FROM public.service_bookings WHERE status = 'completed'
)
SELECT
  ps.total, ps.available, ps.rethus, oc.pros_online,
  fs.total, oc.fam_online,
  is2.total, oc.inst_online,
  sv.completed
FROM pro_stats ps, fam_stats fs, inst_stats is2, online_counts oc, svc sv;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;

-- ─── 5. Agregar columnas faltantes a institution_profiles (si no existen) ─────
ALTER TABLE public.institution_profiles
  ADD COLUMN IF NOT EXISTS lat              double precision,
  ADD COLUMN IF NOT EXISTS lng              double precision,
  ADD COLUMN IF NOT EXISTS visible_on_map   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS compliance_fuid  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_notes text,
  ADD COLUMN IF NOT EXISTS chamber_of_commerce_number text,
  ADD COLUMN IF NOT EXISTS chamber_of_commerce_date   text,
  ADD COLUMN IF NOT EXISTS legal_representative_name  text,
  ADD COLUMN IF NOT EXISTS legal_representative_email text,
  ADD COLUMN IF NOT EXISTS legal_representative_phone text,
  ADD COLUMN IF NOT EXISTS trust_score      numeric DEFAULT 0;

-- ─── 6. Agregar columnas faltantes a family_profiles (si no existen) ──────────
ALTER TABLE public.family_profiles
  ADD COLUMN IF NOT EXISTS id_doc_url   text,
  ADD COLUMN IF NOT EXISTS trust_score  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_hires  integer DEFAULT 0;

-- ─── 7. Índices críticos ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pp_available_active
  ON public.professional_profiles (available, active);
CREATE INDEX IF NOT EXISTS idx_pp_rethus
  ON public.professional_profiles (rethus_verified)
  WHERE rethus_verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_locations_online
  ON public.user_locations (is_online)
  WHERE is_online = TRUE;
CREATE INDEX IF NOT EXISTS idx_job_offers_posted_by_created
  ON public.job_offers (posted_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_bookings_status
  ON public.service_bookings (status);
CREATE INDEX IF NOT EXISTS idx_family_profiles_visible
  ON public.family_profiles (visible_on_map)
  WHERE visible_on_map = TRUE;
CREATE INDEX IF NOT EXISTS idx_institution_profiles_visible
  ON public.institution_profiles (visible_on_map)
  WHERE visible_on_map = TRUE;
