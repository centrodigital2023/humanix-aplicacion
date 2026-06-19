-- ═══════════════════════════════════════════════════════════════════════════
-- Humanix: esquema hiperconectado — tablas faltantes, vistas corregidas,
--          índices, triggers, RLS y get_platform_counts optimizado.
--
-- Corrige:
--  1. security_invoker = false no es sintaxis estándar → removido
--  2. family_profiles / institution_profiles no existen → se crean
--  3. get_platform_counts hace 9 full-scans → reescrito con CTEs
--  4. Usuarios online calculados con DISTINCT ON (última ubicación)
--  5. Índices esenciales para performance
--  6. Triggers para auto-crear perfiles al registrar rol
--  7. RLS para todos los paneles
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. Extensiones ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── 1. TABLA: family_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_profiles (
  user_id           uuid        PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  id_number         text,
  whatsapp          text,
  default_address   text,
  id_doc_url        text,
  default_lat       double precision,
  default_lng       double precision,
  visible_on_map    boolean     NOT NULL DEFAULT true,
  trust_score       numeric     DEFAULT 0,
  total_hires       integer     DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. TABLA: institution_profiles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.institution_profiles (
  user_id                       uuid        PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  institution_name              text,
  nit                           text,
  chamber_of_commerce_number    text,
  chamber_of_commerce_date      text,
  institution_type              text        DEFAULT 'ips',
  legal_representative_name     text,
  legal_representative_email    text,
  legal_representative_phone    text,
  city                          text,
  address                       text,
  website                       text,
  compliance_notes              text,
  compliance_fuid               boolean     DEFAULT false,
  lat                           double precision,
  lng                           double precision,
  visible_on_map                boolean     NOT NULL DEFAULT true,
  verified                      boolean     DEFAULT false,
  trust_score                   numeric     DEFAULT 0,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. Backfill: crear perfiles para usuarios ya registrados ─────────────────
-- Familias existentes en user_roles sin entrada en family_profiles
INSERT INTO public.family_profiles (user_id)
SELECT ur.user_id
FROM   public.user_roles ur
WHERE  ur.role = 'family'
  AND  NOT EXISTS (
         SELECT 1 FROM public.family_profiles fp WHERE fp.user_id = ur.user_id
       )
ON CONFLICT (user_id) DO NOTHING;

-- Instituciones existentes en user_roles sin entrada en institution_profiles
INSERT INTO public.institution_profiles (user_id)
SELECT ur.user_id
FROM   public.user_roles ur
WHERE  ur.role = 'institution'
  AND  NOT EXISTS (
         SELECT 1 FROM public.institution_profiles ip WHERE ip.user_id = ur.user_id
       )
ON CONFLICT (user_id) DO NOTHING;

-- ─── 4. Trigger: auto-crear perfil al asignar un rol ─────────────────────────
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

-- ─── 5. updated_at trigger helper ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_family_profiles_updated_at ON public.family_profiles;
CREATE TRIGGER trg_family_profiles_updated_at
  BEFORE UPDATE ON public.family_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_institution_profiles_updated_at ON public.institution_profiles;
CREATE TRIGGER trg_institution_profiles_updated_at
  BEFORE UPDATE ON public.institution_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 6. RLS para family_profiles ─────────────────────────────────────────────
ALTER TABLE public.family_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_profiles_select_own"  ON public.family_profiles;
DROP POLICY IF EXISTS "family_profiles_insert_own"  ON public.family_profiles;
DROP POLICY IF EXISTS "family_profiles_update_own"  ON public.family_profiles;
DROP POLICY IF EXISTS "family_profiles_delete_own"  ON public.family_profiles;

CREATE POLICY "family_profiles_select_own"
  ON public.family_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "family_profiles_insert_own"
  ON public.family_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "family_profiles_update_own"
  ON public.family_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "family_profiles_delete_own"
  ON public.family_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- ─── 7. RLS para institution_profiles ────────────────────────────────────────
ALTER TABLE public.institution_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "institution_profiles_select_own"  ON public.institution_profiles;
DROP POLICY IF EXISTS "institution_profiles_insert_own"  ON public.institution_profiles;
DROP POLICY IF EXISTS "institution_profiles_update_own"  ON public.institution_profiles;
DROP POLICY IF EXISTS "institution_profiles_delete_own"  ON public.institution_profiles;

CREATE POLICY "institution_profiles_select_own"
  ON public.institution_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "institution_profiles_insert_own"
  ON public.institution_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "institution_profiles_update_own"
  ON public.institution_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

CREATE POLICY "institution_profiles_delete_own"
  ON public.institution_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- ─── 8. VISTA: public_professionals_safe ─────────────────────────────────────
-- Solo professionals con perfil publicado aparecen en el mapa.
-- Contadores incluyen todos (query separada en get_platform_counts).
DROP VIEW IF EXISTS public.public_professionals_safe CASCADE;
CREATE VIEW public.public_professionals_safe
WITH (security_barrier = true) AS
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
  -- rethus_number omitido de vista pública (dato profesional sensible)
  pp.ai_summary,
  pp.ai_strengths,
  pp.certifications,
  pp.work_experience,
  pp.languages,
  pp.availability,
  COALESCE(pp.available, FALSE)                               AS available,
  CASE
    WHEN COALESCE(pp.reserved_until > now(), FALSE) THEN 'busy'
    WHEN pp.available = TRUE THEN 'available'
    ELSE 'unavailable'
  END                                                         AS availability_status,
  pp.active,
  pp.published,
  pp.ai_preapproved,
  pp.reserved_until,
  COALESCE(pp.blocked, FALSE)                                 AS blocked,
  COALESCE(pp.avatar_url, pr.avatar_url)                      AS avatar_url,
  pp.bio,
  COALESCE(pr.full_name, 'Profesional')                       AS full_name,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.professional_profiles pp ON pp.user_id = ur.user_id
LEFT JOIN public.profiles pr              ON pr.user_id = ur.user_id
WHERE ur.role = 'professional'
  AND COALESCE(pp.blocked, FALSE) = FALSE
  AND COALESCE(pp.active, TRUE) IS NOT FALSE;

GRANT SELECT ON public.public_professionals_safe TO anon, authenticated;

-- ─── 9. VISTA: public_family_map_safe ────────────────────────────────────────
DROP VIEW IF EXISTS public.public_family_map_safe CASCADE;
CREATE VIEW public.public_family_map_safe
WITH (security_barrier = true) AS
SELECT
  ur.user_id,
  fp.default_lat,
  fp.default_lng,
  (fp.default_lat IS NOT NULL AND fp.default_lng IS NOT NULL) AS has_exact_location,
  -- patient_name: título de última oferta publicada, o "Familia"
  COALESCE(jo.title, 'Familia')                               AS patient_name,
  -- default_address: desde family_profiles o última oferta
  COALESCE(fp.default_address, jo.city, pr.city)              AS default_address,
  COALESCE(fp.visible_on_map, TRUE)                           AS visible_on_map,
  -- whatsapp desde family_profiles, fallback a profiles.phone
  COALESCE(fp.whatsapp, pr.phone)                             AS whatsapp,
  COALESCE(pr.full_name, 'Familia')                           AS full_name,
  COALESCE(pr.avatar_url, '')                                 AS avatar_url,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles       pr ON pr.user_id = ur.user_id
LEFT JOIN public.family_profiles fp ON fp.user_id = ur.user_id
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

-- ─── 10. VISTA: public_institutions_safe ─────────────────────────────────────
DROP VIEW IF EXISTS public.public_institutions_safe CASCADE;
CREATE VIEW public.public_institutions_safe
WITH (security_barrier = true) AS
SELECT
  ur.user_id,
  ip.lat,
  ip.lng,
  (ip.lat IS NOT NULL AND ip.lng IS NOT NULL)                 AS has_exact_location,
  COALESCE(ip.institution_name, pr.full_name, 'Institución')  AS institution_name,
  COALESCE(ip.city, jo.city, pr.city)                         AS city,
  COALESCE(ip.address, jo.address)                            AS address,
  COALESCE(ip.institution_type, 'otro')                       AS institution_type,
  COALESCE(ip.visible_on_map, TRUE)                           AS visible_on_map,
  COALESCE(pr.full_name, ip.institution_name, 'Institución')  AS full_name,
  COALESCE(pr.avatar_url, '')                                 AS avatar_url,
  pr.phone
FROM public.user_roles ur
LEFT JOIN public.profiles           pr ON pr.user_id = ur.user_id
LEFT JOIN public.institution_profiles ip ON ip.user_id = ur.user_id
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

-- ─── 11. get_platform_counts — reescrito con CTEs (1 scan por tabla) ──────────
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
WITH
-- Un solo scan de user_roles para todos los conteos de roles
role_counts AS (
  SELECT
    COUNT(DISTINCT user_id) FILTER (WHERE role = 'professional') AS professionals,
    COUNT(DISTINCT user_id) FILTER (WHERE role = 'family')       AS families,
    COUNT(DISTINCT user_id) FILTER (WHERE role = 'institution')  AS institutions
  FROM public.user_roles
),
-- Un solo scan de professional_profiles
pro_stats AS (
  SELECT
    COUNT(*) FILTER (
      WHERE available = TRUE
        AND COALESCE(blocked, FALSE) = FALSE
        AND COALESCE(active, TRUE) IS NOT FALSE
    )                                                              AS available,
    COUNT(*) FILTER (
      WHERE rethus_verified = TRUE
        AND COALESCE(blocked, FALSE) = FALSE
    )                                                              AS rethus
  FROM public.professional_profiles
),
-- Online: última ubicación por usuario (DISTINCT ON evita contar duplicados)
latest_locations AS (
  SELECT DISTINCT ON (ul.user_id)
    ul.user_id,
    ul.is_online,
    ur.role
  FROM public.user_locations ul
  JOIN public.user_roles ur ON ur.user_id = ul.user_id
  ORDER BY ul.user_id, ul.updated_at DESC NULLS LAST
),
online_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE role = 'professional' AND is_online = TRUE) AS pros_online,
    COUNT(*) FILTER (WHERE role = 'family'       AND is_online = TRUE) AS fam_online,
    COUNT(*) FILTER (WHERE role = 'institution'  AND is_online = TRUE) AS inst_online
  FROM latest_locations
),
-- Servicios completados
svc AS (
  SELECT COUNT(*) AS completed
  FROM public.service_bookings
  WHERE status = 'completed'
)
SELECT
  rc.professionals,
  ps.available,
  ps.rethus,
  oc.pros_online,
  rc.families,
  oc.fam_online,
  rc.institutions,
  oc.inst_online,
  sv.completed
FROM role_counts rc, pro_stats ps, online_counts oc, svc sv;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;

-- ─── 12. Índices críticos ─────────────────────────────────────────────────────
-- user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_role
  ON public.user_roles (role);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_role
  ON public.user_roles (user_id, role);

-- professional_profiles
CREATE INDEX IF NOT EXISTS idx_pp_available_active
  ON public.professional_profiles (available, active, blocked)
  WHERE blocked IS DISTINCT FROM TRUE;
CREATE INDEX IF NOT EXISTS idx_pp_published
  ON public.professional_profiles (published)
  WHERE published = TRUE;
CREATE INDEX IF NOT EXISTS idx_pp_rethus
  ON public.professional_profiles (rethus_verified)
  WHERE rethus_verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_pp_reserved
  ON public.professional_profiles (reserved_until)
  WHERE reserved_until IS NOT NULL;

-- user_locations (latest location lookup)
CREATE INDEX IF NOT EXISTS idx_user_locations_user_updated
  ON public.user_locations (user_id, updated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_user_locations_online
  ON public.user_locations (is_online)
  WHERE is_online = TRUE;

-- job_offers
CREATE INDEX IF NOT EXISTS idx_job_offers_posted_by_created
  ON public.job_offers (posted_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_offers_poster_type
  ON public.job_offers (poster_type);

-- service_bookings
CREATE INDEX IF NOT EXISTS idx_service_bookings_status
  ON public.service_bookings (status);

-- family_profiles / institution_profiles
CREATE INDEX IF NOT EXISTS idx_family_profiles_visible
  ON public.family_profiles (visible_on_map)
  WHERE visible_on_map = TRUE;
CREATE INDEX IF NOT EXISTS idx_institution_profiles_visible
  ON public.institution_profiles (visible_on_map)
  WHERE visible_on_map = TRUE;

-- ─── 13. Comentarios de tabla ─────────────────────────────────────────────────
COMMENT ON TABLE public.family_profiles      IS 'Perfil extendido de usuarios con rol family.';
COMMENT ON TABLE public.institution_profiles IS 'Perfil extendido de usuarios con rol institution.';
