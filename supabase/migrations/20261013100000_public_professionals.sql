-- ═══════════════════════════════════════════════════════════════════════════════
-- DIRECTORIO PÚBLICO DE PROFESIONALES (2026-10-13): el buscador, el perfil público y los flujos guiados vuelven a mostrar profesionales.
--
-- Qué había en producción
--   • Buscador (/buscar), perfil público (/profesional/:id), flujo guiado de la familia, «¿A quién necesitas?» de la institución,
--     «Mis servicios» y la comparación de postulaciones leían las vistas public_professionals_safe / public_profiles_safe. Ambas son
--     security_invoker y parten de user_roles / profiles, que por RLS solo ve su dueño, el personal o la contraparte de una
--     postulación aceptada: para cualquier otra cuenta (familia, institución, visitante) devuelven CERO filas. Hoy el directorio sale
--     vacío para todo el que no sea personal.
--   • La vista (si alguien «arreglara» eso dándole más acceso) entregaría el teléfono del profesional y sus coordenadas exactas.
--   • professional_profiles tiene una política de lectura pública del perfil publicado (todas las columnas). No se toca aquí: se
--     recomienda cerrarla cuando todos los lectores usen esta función (queda anotado en docs/AUDIT_REPORT.md).
--
-- Qué hace
--   public_professionals(...): lista o consulta por id a los profesionales PUBLICADOS (activos y no bloqueados). Mismas columnas que
--   leían las pantallas, menos lo que no debe viajar: sin teléfono; coordenadas en cuadrícula de ~1 km (nunca el punto exacto); nombre
--   completo, foto y número de RETHUS solo con sesión iniciada (el visitante ve «Laura P.», sin foto). El dueño del perfil y el
--   personal pueden consultar por id también lo no publicado (igual que con la RLS de la tabla).
--   Filtros en el servidor (especialidad, ciudad, verificado, tarifa por hora, calificación) y tope de 500 filas.
--
-- Idempotente. Depende de 20261012190000 (hx_pro_label, hx_cell vía 20261012210000, hx_presence_ttl).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.public_professionals(
  p_ids        uuid[]  DEFAULT NULL,
  p_specialty  text    DEFAULT NULL,
  p_city       text    DEFAULT NULL,
  p_verified   boolean DEFAULT NULL,
  p_min_rate   integer DEFAULT NULL,
  p_max_rate   integer DEFAULT NULL,
  p_min_rating numeric DEFAULT NULL,
  p_limit      integer DEFAULT 60
)
RETURNS TABLE (
  user_id uuid, full_name text, avatar_url text, specialty text, sub_specialties text[], gender text, years_experience integer,
  home_city text, service_cities text[], hourly_rate integer, shift_rate integer, monthly_rate integer, avg_rating numeric,
  total_jobs integer, trust_score integer, verified boolean, rethus_verified boolean, rethus_number text, ai_summary text,
  ai_strengths text[], certifications jsonb, work_experience jsonb, languages text[], availability jsonb, bio text,
  available boolean, availability_status text, reserved_until timestamptz, active boolean, published boolean,
  lat double precision, lng double precision, live boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_staff boolean := false;
  v_spec  text := NULLIF(btrim(COALESCE(p_specialty, '')), '');
  v_city  text := NULLIF(btrim(COALESCE(p_city, '')), '');
  v_limit integer;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_staff := public.is_staff(v_uid);
  END IF;
  -- Las búsquedas por id (perfil, nombres de postulantes) pueden pedir más filas que el tope de una lista.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 60), COALESCE(cardinality(p_ids), 0), 1), 500);

  RETURN QUERY
  WITH running AS (
    SELECT DISTINCT b.professional_id AS pro_id
      FROM public.service_bookings b
     WHERE b.status = 'in_progress'
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  )
  SELECT pp.user_id,
         public.hx_pro_label(pr.full_name, v_uid IS NULL),
         CASE WHEN v_uid IS NULL THEN NULL ELSE COALESCE(pp.avatar_url, pr.avatar_url) END,
         pp.specialty, pp.sub_specialties, pp.gender, pp.years_experience,
         pp.home_city, pp.service_cities, pp.hourly_rate, pp.shift_rate, pp.monthly_rate, pp.avg_rating,
         pp.total_jobs, pp.trust_score, COALESCE(pp.verified, false), COALESCE(pp.rethus_verified, false),
         CASE WHEN v_uid IS NULL THEN NULL ELSE pp.rethus_number END,
         pp.ai_summary, pp.ai_strengths, pp.certifications, pp.work_experience, pp.languages, pp.availability, pp.bio,
         COALESCE(pp.available, false),
         CASE WHEN COALESCE(pp.reserved_until > now(), false) OR EXISTS (SELECT 1 FROM running r WHERE r.pro_id = pp.user_id) THEN 'busy'
              WHEN COALESCE(pp.available, false) THEN 'available'
              ELSE 'unavailable' END,
         pp.reserved_until, COALESCE(pp.active, true), COALESCE(pp.published, false),
         public.hx_cell(pp.lat), public.hx_cell(pp.lng),
         COALESCE(ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl(), false)
    FROM public.professional_profiles pp
    LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
    LEFT JOIN public.user_locations ul ON ul.user_id = pp.user_id
   WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pp.user_id AND ur.role = 'professional'::public.app_role)
     AND ((COALESCE(pp.published, false) AND COALESCE(pp.active, true) AND NOT COALESCE(pp.blocked, false))
          OR (p_ids IS NOT NULL AND (pp.user_id = v_uid OR v_staff)))
     AND (p_ids IS NULL OR pp.user_id = ANY (p_ids))
     AND (v_spec IS NULL OR pp.specialty ILIKE '%' || v_spec || '%')
     AND (v_city IS NULL
          OR lower(btrim(COALESCE(pp.home_city, ''))) = lower(v_city)
          OR EXISTS (SELECT 1 FROM unnest(COALESCE(pp.service_cities, '{}'::text[])) c WHERE lower(btrim(c)) = lower(v_city)))
     AND (p_verified IS NOT TRUE OR COALESCE(pp.verified, false))
     AND (p_min_rate IS NULL OR pp.hourly_rate >= p_min_rate)
     AND (p_max_rate IS NULL OR pp.hourly_rate <= p_max_rate)
     AND (p_min_rating IS NULL OR pp.avg_rating >= p_min_rating)
   ORDER BY pp.avg_rating DESC NULLS LAST, pp.trust_score DESC NULLS LAST, pp.user_id
   LIMIT v_limit;
END
$fn$;

REVOKE ALL ON FUNCTION public.public_professionals(uuid[], text, text, boolean, integer, integer, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_professionals(uuid[], text, text, boolean, integer, integer, numeric, integer) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
