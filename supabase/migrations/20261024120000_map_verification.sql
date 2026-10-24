-- ═══════════════════════════════════════════════════════════════════════════════
-- MAPA EN VIVO POR VERIFICACIÓN DOCUMENTAL (pedido el 2026-10-24) + rastreo del profesional solo en «En camino» y «Cuidando».
--
-- Pedido
--   • Usuarios con documentos completos y validados (badge verde): pin activo con foto, estado y ubicación en vivo.
--   • Usuarios con documentos incompletos o en revisión: SÍ aparecen, con pin ámbar «Documentos pendientes»; al tocarlos no se puede
--     contratar ni asignar, se abre un aviso (Habeas Data, Ley 1581 de 2012).
--   • La posición del profesional se comparte con la familia o la EPS/IPS solo mientras el servicio está «En camino» o «Cuidando».
--
-- Qué hace
--   1. hx_pro_docs_complete(uid): CV, documento de identidad y ReTHUS o diploma, los tres APROBADOS (misma lista que
--      `supabase/functions/_shared/professionalDocumentRequirements.ts`, pero exige aprobación y no solo carga).
--   2. map_professionals(): nueva columna verification_status ('verified' | 'pending').
--        verified = perfil publicado + documentos aprobados + verificación (verified, rethus_verified o verification_status='verified').
--        pending  = todo lo demás. Además entran los profesionales SIN publicar que ya guardaron su zona (activos y no bloqueados):
--        salen ámbar, sin foto ni tarifa (no publicaron su perfil) y con el nombre abreviado; nadie puede contratarlos desde el mapa.
--   3. map_open_demand() y map_institutions(): la misma columna para familias (soporte de identidad cargado) e instituciones
--      (validadas por Humanix).
--   4. tracking_pings: el profesional solo puede enviar su posición con el servicio en 'in_route' o 'in_progress'; la familia, la
--      cuenta institucional que lo pidió, su círculo de cuidado con permiso de ver servicios y el personal la leen solo mientras dure
--      ese estado (al terminar o cancelar, la ruta deja de ser visible para el cliente). Limpieza: pings de más de 30 días.
--
-- Idempotente. Depende de 20261012210000_live_map.sql. Las firmas de entrada no cambian; las columnas de salida sí (DROP + CREATE).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Documentos completos ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_pro_docs_complete(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.professional_documents d WHERE d.user_id = p_uid AND d.doc_type = 'cv' AND d.status = 'approved')
     AND EXISTS (SELECT 1 FROM public.professional_documents d WHERE d.user_id = p_uid AND d.doc_type = 'id_document' AND d.status = 'approved')
     AND EXISTS (SELECT 1 FROM public.professional_documents d WHERE d.user_id = p_uid AND d.doc_type IN ('rethus', 'diploma') AND d.status = 'approved')
$fn$;
REVOKE ALL ON FUNCTION public.hx_pro_docs_complete(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2) Profesionales ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.map_professionals(double precision, double precision, double precision, integer);
CREATE OR REPLACE FUNCTION public.map_professionals(
  p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_radius_km double precision DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS TABLE (
  pro_id uuid, display_name text, avatar_url text, specialty text, sub_specialties text[], gender text, years_experience integer,
  hourly_rate integer, avg_rating numeric, trust_score integer, rethus_verified boolean, verified boolean, home_city text,
  lat double precision, lng double precision, status text, live boolean, last_seen timestamptz, verification_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH running AS (
    SELECT DISTINCT b.professional_id AS pro_id
      FROM public.service_bookings b
     WHERE b.status IN ('in_route', 'in_progress')
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  ),
  cand AS (
    SELECT pp.*, COALESCE(pp.published, false) AS is_published,
           (COALESCE(pp.published, false) AND public.hx_pro_docs_complete(pp.user_id)
            AND (COALESCE(pp.verified, false) OR COALESCE(pp.rethus_verified, false) OR pp.verification_status = 'verified')) AS is_verified
      FROM public.professional_profiles pp
     WHERE COALESCE(pp.active, true) AND NOT COALESCE(pp.blocked, false)
       AND (COALESCE(pp.published, false) OR (pp.lat IS NOT NULL AND pp.lng IS NOT NULL))
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pp.user_id AND ur.role = 'professional'::public.app_role)
  ),
  base AS (
    SELECT c.user_id AS pro_id,
           public.hx_pro_label(pr.full_name, true) AS display_name,
           -- Foto solo con sesión y solo de perfiles publicados.
           CASE WHEN v_uid IS NULL OR NOT c.is_published THEN NULL ELSE COALESCE(c.avatar_url, pr.avatar_url) END AS avatar_url,
           c.specialty, c.sub_specialties, c.gender, c.years_experience,
           CASE WHEN c.is_published THEN c.hourly_rate END AS hourly_rate,
           c.avg_rating, c.trust_score,
           COALESCE(c.rethus_verified, false) AS rethus_verified, COALESCE(c.verified, false) AS verified, c.home_city,
           COALESCE(CASE WHEN ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl() THEN ul.lat END, public.hx_cell(c.lat)) AS lat,
           COALESCE(CASE WHEN ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl() THEN ul.lng END, public.hx_cell(c.lng)) AS lng,
           CASE WHEN COALESCE(c.reserved_until > now(), false) OR EXISTS (SELECT 1 FROM running r WHERE r.pro_id = c.user_id) THEN 'busy'
                WHEN COALESCE(c.available, false) THEN 'available'
                ELSE 'unavailable' END AS status,
           COALESCE(ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl(), false) AS live,
           ul.last_seen,
           CASE WHEN c.is_verified THEN 'verified' ELSE 'pending' END AS verification_status
      FROM cand c
      LEFT JOIN public.profiles pr ON pr.user_id = c.user_id
      LEFT JOIN public.user_locations ul ON ul.user_id = c.user_id
  )
  SELECT b.pro_id, b.display_name, b.avatar_url, b.specialty, b.sub_specialties, b.gender, b.years_experience, b.hourly_rate, b.avg_rating,
         b.trust_score, b.rethus_verified, b.verified, b.home_city, b.lat, b.lng, b.status, b.live, b.last_seen, b.verification_status
    FROM base b
   WHERE p_radius_km IS NULL OR p_lat IS NULL OR p_lng IS NULL
         OR public.hx_distance_km(p_lat, p_lng, b.lat, b.lng) <= p_radius_km
   ORDER BY (b.verification_status = 'verified') DESC, b.live DESC, (b.status = 'available') DESC, (b.status = 'busy') DESC,
            public.hx_distance_km(p_lat, p_lng, b.lat, b.lng) NULLS LAST, b.avg_rating DESC NULLS LAST, b.pro_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END
$fn$;

-- ── 3) Familias e instituciones con demanda abierta ─────────────────────────────

DROP FUNCTION IF EXISTS public.map_open_demand(double precision, double precision, double precision, integer);
CREATE OR REPLACE FUNCTION public.map_open_demand(
  p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_radius_km double precision DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS TABLE (
  poster_id uuid, poster_kind text, display_name text, city text, lat double precision, lng double precision,
  open_offers integer, open_hours numeric, top_hourly integer, is_urgent boolean, offer_id uuid,
  trust_score integer, trust_level text, trust_enough boolean, distance_band integer, verification_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'professional'::public.app_role) OR public.is_staff(v_uid)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH offers AS (
    SELECT o.posted_by AS poster, o.poster_type::text AS kind, o.id, o.city, o.lat, o.lng, COALESCE(o.is_urgent, false) AS urgent, o.created_at,
           CASE o.modality::text WHEN 'hour'  THEN o.amount
                                 WHEN 'shift' THEN round(o.amount / 8.0)::integer
                                 WHEN 'month' THEN round(o.amount / 192.0)::integer END AS hourly
      FROM public.job_offers o
     WHERE o.status = 'open' AND NOT COALESCE(o.blocked, false)
  ),
  needs AS (
    SELECT n.family_user_id AS poster, n.hourly_rate AS hourly,
           GREATEST(extract(epoch FROM (n.ends_at - n.starts_at)) / 3600.0, 0) AS hours
      FROM public.family_needs n
     WHERE n.status = 'open' AND n.ends_at > now()
  ),
  posters AS (
    SELECT o.poster, o.kind FROM offers o
    UNION
    SELECT n.poster, 'family' FROM needs n
  ),
  agg AS (
    SELECT p.poster, p.kind,
           (SELECT count(*) FROM offers o WHERE o.poster = p.poster)::integer AS open_offers,
           round(COALESCE((SELECT sum(n.hours) FROM needs n WHERE n.poster = p.poster), 0)::numeric, 1) AS open_hours,
           GREATEST((SELECT max(o.hourly) FROM offers o WHERE o.poster = p.poster),
                    (SELECT max(n.hourly) FROM needs n WHERE n.poster = p.poster)) AS top_hourly,
           COALESCE((SELECT bool_or(o.urgent) FROM offers o WHERE o.poster = p.poster), false) AS urgent,
           (SELECT o.id FROM offers o WHERE o.poster = p.poster ORDER BY o.created_at DESC LIMIT 1) AS offer_id,
           (SELECT o.city FROM offers o WHERE o.poster = p.poster AND o.city IS NOT NULL ORDER BY o.created_at DESC LIMIT 1) AS offer_city,
           (SELECT o.lat FROM offers o WHERE o.poster = p.poster AND o.lat IS NOT NULL AND o.lng IS NOT NULL ORDER BY o.created_at DESC LIMIT 1) AS offer_lat,
           (SELECT o.lng FROM offers o WHERE o.poster = p.poster AND o.lat IS NOT NULL AND o.lng IS NOT NULL ORDER BY o.created_at DESC LIMIT 1) AS offer_lng
      FROM posters p
  ),
  pins AS (
    SELECT a.poster AS poster_id, a.kind AS poster_kind,
           CASE WHEN a.kind = 'institution' THEN COALESCE(ip.institution_name, pr.full_name, 'Institución')
                ELSE public.short_display_name(pr.full_name) END AS display_name,
           COALESCE(a.offer_city, CASE WHEN a.kind = 'institution' THEN ip.city END, pr.city) AS city,
           public.hx_cell(COALESCE(a.offer_lat, CASE WHEN a.kind = 'institution' THEN ip.lat ELSE fp.default_lat END)) AS lat,
           public.hx_cell(COALESCE(a.offer_lng, CASE WHEN a.kind = 'institution' THEN ip.lng ELSE fp.default_lng END)) AS lng,
           a.open_offers, a.open_hours, a.top_hourly, a.urgent AS is_urgent, a.offer_id,
           CASE WHEN a.kind = 'institution' THEN CASE WHEN COALESCE(ip.verified, false) THEN 'verified' ELSE 'pending' END
                ELSE CASE WHEN fp.id_doc_url IS NOT NULL THEN 'verified' ELSE 'pending' END END AS verification_status
      FROM agg a
      LEFT JOIN public.profiles pr ON pr.user_id = a.poster
      LEFT JOIN public.family_profiles fp ON fp.user_id = a.poster AND a.kind = 'family'
      LEFT JOIN public.institution_profiles ip ON ip.user_id = a.poster AND a.kind = 'institution'
     WHERE COALESCE(CASE WHEN a.kind = 'institution' THEN ip.visible_on_map ELSE fp.visible_on_map END, true)
  )
  SELECT x.poster_id, x.poster_kind, x.display_name, x.city, x.lat, x.lng, x.open_offers, x.open_hours, x.top_hourly, x.is_urgent, x.offer_id,
         t.score, t.level, t.enough_data,
         public.hx_distance_band(public.hx_distance_km(p_lat, p_lng, x.lat, x.lng)),
         x.verification_status
    FROM pins x
    LEFT JOIN LATERAL public.hx_trust_calc(x.poster_id, x.poster_kind) t ON true
   WHERE p_radius_km IS NULL OR p_lat IS NULL OR p_lng IS NULL
         OR public.hx_distance_km(p_lat, p_lng, x.lat, x.lng) <= p_radius_km
   ORDER BY x.is_urgent DESC, public.hx_distance_km(p_lat, p_lng, x.lat, x.lng) NULLS LAST, x.top_hourly DESC NULLS LAST, x.poster_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END
$fn$;

-- ── 4) Instituciones ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.map_institutions(integer);
CREATE OR REPLACE FUNCTION public.map_institutions(p_limit integer DEFAULT 300)
RETURNS TABLE (
  inst_id uuid, name text, institution_type text, city text, lat double precision, lng double precision,
  verified boolean, status text, live boolean, open_offers integer, verification_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH running AS (
    SELECT DISTINCT b.client_id AS uid
      FROM public.service_bookings b
     WHERE b.status IN ('in_route', 'in_progress')
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  ),
  opened AS (
    SELECT o.posted_by AS uid, count(*)::integer AS n
      FROM public.job_offers o
     WHERE o.status = 'open' AND NOT COALESCE(o.blocked, false) AND o.poster_type::text = 'institution'
     GROUP BY o.posted_by
  )
  SELECT ip.user_id,
         COALESCE(ip.institution_name, pr.full_name, 'Institución'),
         COALESCE(ip.institution_type, 'otro'),
         COALESCE(ip.city, pr.city),
         public.hx_cell(ip.lat, 0.005), public.hx_cell(ip.lng, 0.005),
         COALESCE(ip.verified, false),
         CASE WHEN EXISTS (SELECT 1 FROM running r WHERE r.uid = ip.user_id) THEN 'busy'
              WHEN COALESCE(op.n, 0) > 0 THEN 'available'
              ELSE 'idle' END,
         COALESCE(ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl(), false),
         COALESCE(op.n, 0),
         CASE WHEN COALESCE(ip.verified, false) THEN 'verified' ELSE 'pending' END
    FROM public.institution_profiles ip
    LEFT JOIN public.profiles pr ON pr.user_id = ip.user_id
    LEFT JOIN public.user_locations ul ON ul.user_id = ip.user_id
    LEFT JOIN opened op ON op.uid = ip.user_id
   WHERE COALESCE(ip.visible_on_map, true)
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = ip.user_id AND ur.role = 'institution'::public.app_role)
   ORDER BY 9 DESC, 10 DESC, ip.user_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END
$fn$;

REVOKE ALL ON FUNCTION public.map_professionals(double precision, double precision, double precision, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.map_open_demand(double precision, double precision, double precision, integer)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.map_institutions(integer)                                                        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_professionals(double precision, double precision, double precision, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.map_open_demand(double precision, double precision, double precision, integer)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.map_institutions(integer)                                                        TO anon, authenticated;

-- El mapa cambia cuando cambia un documento (pasa a aprobado o rechazado): mismo aviso sin datos que el resto del mapa.
DROP TRIGGER IF EXISTS trg_professional_documents_ping_map ON public.professional_documents;
CREATE TRIGGER trg_professional_documents_ping_map
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.professional_documents
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_ping_map();

-- ── 5) Rastreo del profesional (Habeas Data) ────────────────────────────────────

-- Quién puede ver la ruta de un servicio mientras está en curso.
CREATE OR REPLACE FUNCTION public.hx_can_track_booking(p_booking uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.service_bookings b
     WHERE b.id = p_booking
       AND (b.professional_id = p_uid
            OR public.is_staff(p_uid)
            OR (b.status IN ('in_route', 'in_progress')
                AND (b.client_id = p_uid
                     OR EXISTS (SELECT 1 FROM public.care_circle_members m
                                 WHERE m.owner_id = b.client_id AND m.member_id = p_uid
                                   AND m.status = 'accepted' AND m.can_view_services))))
  )
$fn$;
REVOKE ALL ON FUNCTION public.hx_can_track_booking(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_can_track_booking(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS tracking_insert_pro ON public.tracking_pings;
CREATE POLICY tracking_insert_pro ON public.tracking_pings
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = professional_id
    AND EXISTS (SELECT 1 FROM public.service_bookings b
                 WHERE b.id = tracking_pings.booking_id AND b.professional_id = auth.uid()
                   AND b.status IN ('in_route', 'in_progress'))
    AND lat BETWEEN -5 AND 14 AND lng BETWEEN -82 AND -66
  );

DROP POLICY IF EXISTS tracking_select_involved ON public.tracking_pings;
CREATE POLICY tracking_select_involved ON public.tracking_pings
  FOR SELECT TO authenticated
  USING (public.hx_can_track_booking(booking_id, auth.uid()));

-- Nadie modifica ni borra pings desde el cliente.
REVOKE UPDATE, DELETE ON public.tracking_pings FROM anon, authenticated;
REVOKE ALL ON public.tracking_pings FROM anon;
GRANT SELECT, INSERT ON public.tracking_pings TO authenticated;
GRANT ALL ON public.tracking_pings TO service_role;

-- La ruta no se guarda para siempre: lo de más de 30 días se borra al insertar (ocasionalmente, sin cron).
CREATE OR REPLACE FUNCTION public.trg_tracking_pings_purge()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF random() < 0.02 THEN
    DELETE FROM public.tracking_pings WHERE created_at < now() - interval '30 days';
  END IF;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS trg_tracking_pings_purge ON public.tracking_pings;
CREATE TRIGGER trg_tracking_pings_purge
  AFTER INSERT ON public.tracking_pings
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_tracking_pings_purge();

NOTIFY pgrst, 'reload schema';
