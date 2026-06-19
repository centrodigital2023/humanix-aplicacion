-- ═══════════════════════════════════════════════════════════════════════════
-- HUMANIX — Migración definitiva para proyecto rwllmouomrytejtbpxvn
--
-- Qué hace:
--   1. Backfill family_profiles / institution_profiles para todos los
--      usuarios en user_roles que no tienen perfil todavía.
--   2. Recrea las 3 vistas públicas usando user_roles como fuente
--      (garantiza que TODOS los usuarios registrados aparezcan en el mapa)
--      y agrega full_name, phone, has_exact_location.
--   3. CREATE OR REPLACE get_platform_counts() para actualizarla si existe.
--   4. Índices de rendimiento.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. Columnas extra en institution_profiles (idempotente) ─────────────────
ALTER TABLE public.institution_profiles
  ADD COLUMN IF NOT EXISTS lat              double precision,
  ADD COLUMN IF NOT EXISTS lng              double precision,
  ADD COLUMN IF NOT EXISTS visible_on_map   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trust_score      numeric DEFAULT 0;

-- ─── 1. Backfill: crear filas en family_profiles para familias sin perfil ─────
INSERT INTO public.family_profiles (user_id)
SELECT ur.user_id
FROM   public.user_roles ur
WHERE  ur.role = 'family'
  AND  NOT EXISTS (SELECT 1 FROM public.family_profiles fp WHERE fp.user_id = ur.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- ─── 2. Backfill: crear filas en institution_profiles para instituciones ──────
INSERT INTO public.institution_profiles (user_id, institution_name)
SELECT ur.user_id, COALESCE(pr.full_name, 'Institución')
FROM   public.user_roles ur
LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
WHERE  ur.role = 'institution'
  AND  NOT EXISTS (SELECT 1 FROM public.institution_profiles ip WHERE ip.user_id = ur.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- ─── 3. Trigger: auto-crear perfil cuando se asigna un rol ───────────────────
CREATE OR REPLACE FUNCTION public.create_role_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'family' THEN
    INSERT INTO public.family_profiles (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSIF NEW.role = 'institution' THEN
    INSERT INTO public.institution_profiles (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_role_profile ON public.user_roles;
CREATE TRIGGER trg_create_role_profile
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.create_role_profile();

-- ─── 4. Vista: public_professionals_safe ─────────────────────────────────────
-- Fuente: user_roles → garantiza todos los profesionales registrados.
-- Incluye full_name, phone y has_exact_location para el mapa.
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_barrier = true) AS
SELECT
  ur.user_id,
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
FROM public.user_roles ur
LEFT JOIN public.professional_profiles pp ON pp.user_id = ur.user_id
LEFT JOIN public.profiles              pr ON pr.user_id = ur.user_id
WHERE ur.role = 'professional'
  AND COALESCE(pp.active, TRUE) IS NOT FALSE;

GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- ─── 5. Vista: public_family_map_safe ────────────────────────────────────────
-- Fuente: user_roles → garantiza todas las familias registradas.
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_barrier = true) AS
SELECT
  ur.user_id,
  fp.default_lat,
  fp.default_lng,
  (fp.default_lat IS NOT NULL AND fp.default_lng IS NOT NULL) AS has_exact_location,
  COALESCE(fp.patient_name, pr.full_name, 'Familia')         AS patient_name,
  COALESCE(fp.default_address, pr.city)                      AS default_address,
  COALESCE(fp.visible_on_map, TRUE)                          AS visible_on_map,
  COALESCE(fp.whatsapp, pr.phone)                            AS whatsapp,
  COALESCE(pr.full_name, 'Familia')                          AS full_name,
  COALESCE(pr.avatar_url, '')                                AS avatar_url,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles        pr ON pr.user_id = ur.user_id
LEFT JOIN public.family_profiles fp ON fp.user_id = ur.user_id
WHERE ur.role = 'family';

GRANT SELECT ON public.public_family_map_safe TO anon, authenticated;

-- ─── 6. Vista: public_institutions_safe ──────────────────────────────────────
-- Fuente: user_roles → garantiza todas las instituciones registradas.
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_barrier = true) AS
SELECT
  ur.user_id,
  ip.lat,
  ip.lng,
  (ip.lat IS NOT NULL AND ip.lng IS NOT NULL)                  AS has_exact_location,
  COALESCE(ip.institution_name, pr.full_name, 'Institución')   AS institution_name,
  COALESCE(ip.city, pr.city)                                   AS city,
  ip.address,
  COALESCE(ip.institution_type, 'otro')                        AS institution_type,
  COALESCE(ip.visible_on_map, TRUE)                            AS visible_on_map,
  COALESCE(pr.full_name, ip.institution_name, 'Institución')   AS full_name,
  COALESCE(pr.avatar_url, '')                                  AS avatar_url,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles             pr ON pr.user_id = ur.user_id
LEFT JOIN public.institution_profiles ip ON ip.user_id = ur.user_id
WHERE ur.role = 'institution';

GRANT SELECT ON public.public_institutions_safe TO anon, authenticated;

-- ─── 7. get_platform_counts — reemplazar con versión desde user_roles ─────────
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
role_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE role = 'professional') AS professionals,
    COUNT(*) FILTER (WHERE role = 'family')       AS families,
    COUNT(*) FILTER (WHERE role = 'institution')  AS institutions
  FROM public.user_roles
),
pro_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE available = TRUE
                      AND COALESCE(active, TRUE) IS NOT FALSE) AS available,
    COUNT(*) FILTER (WHERE rethus_verified = TRUE)             AS rethus
  FROM public.professional_profiles
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
  SELECT COUNT(*) AS completed
  FROM public.service_bookings
  WHERE status = 'completed'
)
SELECT
  rc.professionals, ps.available, ps.rethus, oc.pros_online,
  rc.families,      oc.fam_online,
  rc.institutions,  oc.inst_online,
  sv.completed
FROM role_counts rc, pro_stats ps, online_counts oc, svc sv;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;

-- ─── 8. Índices de rendimiento ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_roles_role
  ON public.user_roles (role);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
  ON public.user_roles (user_id, role);
CREATE INDEX IF NOT EXISTS idx_pp_available_active
  ON public.professional_profiles (available, active);
CREATE INDEX IF NOT EXISTS idx_pp_rethus
  ON public.professional_profiles (rethus_verified)
  WHERE rethus_verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_locations_online
  ON public.user_locations (is_online)
  WHERE is_online = TRUE;
CREATE INDEX IF NOT EXISTS idx_service_bookings_status
  ON public.service_bookings (status);
CREATE INDEX IF NOT EXISTS idx_family_profiles_visible
  ON public.family_profiles (visible_on_map)
  WHERE visible_on_map = TRUE;
CREATE INDEX IF NOT EXISTS idx_institution_profiles_visible
  ON public.institution_profiles (visible_on_map)
  WHERE visible_on_map = TRUE;
