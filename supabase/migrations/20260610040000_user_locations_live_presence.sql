-- ═══════════════════════════════════════════════════════════════════════════
-- user_locations: Tabla de presencia GPS en vivo (estilo Uber/InDrive).
-- Separada de los perfiles para no contaminar datos estáticos del profesional.
-- Cada usuario tiene exactamente un registro; se hace UPSERT al moverse.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_locations (
  user_id     UUID             PRIMARY KEY
                               REFERENCES auth.users(id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  accuracy    REAL,
  heading     REAL,
  speed       REAL,
  is_online   BOOLEAN          NOT NULL DEFAULT TRUE,
  user_type   TEXT             CHECK (user_type IN ('professional', 'family', 'institution')),
  updated_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede ver las ubicaciones de usuarios actualmente online
CREATE POLICY "public_read_online_locations"
  ON public.user_locations
  FOR SELECT
  USING (is_online = TRUE);

-- Cada usuario solo puede escribir su propia ubicación
CREATE POLICY "own_location_write"
  ON public.user_locations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Permisos de tabla
GRANT SELECT ON public.user_locations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_locations TO authenticated;

-- Índice parcial para consultas de usuarios online por posición
CREATE INDEX IF NOT EXISTS idx_user_locations_online_latng
  ON public.user_locations (lat, lng)
  WHERE is_online = TRUE;

-- Índice por tipo de usuario para filtros rápidos
CREATE INDEX IF NOT EXISTS idx_user_locations_user_type
  ON public.user_locations (user_type)
  WHERE is_online = TRUE;

-- Auto-actualizar updated_at en cada UPDATE
CREATE OR REPLACE FUNCTION public.touch_user_location_ts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_location_ts ON public.user_locations;
CREATE TRIGGER trg_user_location_ts
  BEFORE UPDATE ON public.user_locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_user_location_ts();

-- Replica identity FULL para que Supabase Realtime envíe la fila completa
-- en eventos UPDATE y DELETE (necesario para detectar cambios de posición).
ALTER TABLE public.user_locations REPLICA IDENTITY FULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Actualizar get_platform_counts con contadores de "en línea ahora"
-- ═══════════════════════════════════════════════════════════════════════════
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
    -- Profesionales registrados (excluye bloqueados)
    (SELECT COUNT(*)
       FROM public.professional_profiles
      WHERE blocked IS NOT TRUE)                                                       AS professionals_total,

    -- Profesionales marcados como disponibles
    (SELECT COUNT(*)
       FROM public.professional_profiles
      WHERE available = TRUE AND blocked IS NOT TRUE)                                  AS professionals_available,

    -- Profesionales con verificación RETHUS
    (SELECT COUNT(*)
       FROM public.professional_profiles
      WHERE rethus_verified = TRUE AND blocked IS NOT TRUE)                            AS professionals_rethus,

    -- Profesionales con GPS en vivo activo ahora mismo
    (SELECT COUNT(*)
       FROM public.user_locations ul
       JOIN public.professional_profiles pp ON pp.user_id = ul.user_id
      WHERE ul.is_online = TRUE AND pp.blocked IS NOT TRUE)                            AS professionals_online,

    -- Total familias registradas
    (SELECT COUNT(*) FROM public.family_profiles)                                      AS families_total,

    -- Familias con GPS en vivo activo ahora mismo
    (SELECT COUNT(*)
       FROM public.user_locations ul
       JOIN public.family_profiles fp ON fp.user_id = ul.user_id
      WHERE ul.is_online = TRUE)                                                       AS families_online,

    -- Total instituciones registradas
    (SELECT COUNT(*) FROM public.institution_profiles)                                 AS institutions_total,

    -- Instituciones con GPS en vivo activo ahora mismo
    (SELECT COUNT(*)
       FROM public.user_locations ul
       JOIN public.institution_profiles ip ON ip.user_id = ul.user_id
      WHERE ul.is_online = TRUE)                                                       AS institutions_online,

    -- Servicios completados totales
    (SELECT COUNT(*)
       FROM public.service_bookings
      WHERE status = 'completed')                                                      AS completed_services;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_counts() TO anon, authenticated;
