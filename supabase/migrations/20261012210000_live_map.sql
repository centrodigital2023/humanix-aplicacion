-- ═══════════════════════════════════════════════════════════════════════════════
-- MAPAS EN VIVO (decisión pedida el 2026-10-12): contadores reales «disponible / en vivo / ocupado», presencia sin GPS exacto y pines
-- por rol con ubicación aproximada.
--
-- Pedido: los mapas de la EPS/IPS, de las familias y de los profesionales «hiperconectados», con contadores reales en vivo; la familia
-- sigue visible para los profesionales mientras tenga ofertas; el profesional, visible para familias y EPS/IPS; la EPS/IPS ve a los
-- profesionales disponibles y registrados en tiempo real.
--
-- Qué había en producción
--   • Los mapas leían las vistas public_*_safe. Son security_invoker y parten de user_roles, que solo ve su dueño y el personal: para
--     cualquier otra cuenta devuelven cero filas (los mapas salían vacíos). Y si alguien «arreglara» eso dándoles más acceso, entregarían
--     teléfono, dirección, nombre del paciente y WhatsApp de todas las familias (son columnas de la vista).
--   • user_locations NO existe en producción. Su migración original (20260610040000) la deja legible por anónimos con el GPS exacto de
--     todos los que están en línea. Esta migración la reemplaza por un diseño seguro y, si la tabla antigua existiera, la endurece.
--   • get_platform_counts() devuelve ceros fijos en «en línea».
--
-- Qué hace
--   1. user_locations (presencia): una fila por cuenta, posición SIEMPRE en cuadrícula de ~1 km (nunca el GPS exacto) y solo para
--      profesionales que deciden compartirla; familias e instituciones cuentan como «en vivo» pero no publican posición. RLS: cada cuenta
--      lee la suya y el personal todas; nadie escribe directo (solo touch_presence / stop_presence).
--   2. touch_presence() / stop_presence(): latido de presencia. El rol sale de user_roles (no del cliente), las coordenadas se validan y se
--      aproximan en el servidor, y solo se avisa al mapa cuando algo visible cambió (no por cada latido).
--   3. map_professionals(): profesionales publicados con estado (disponible / ocupado / no disponible) y «en vivo»; sin teléfono ni
--      dirección; nombre abreviado; posición en cuadrícula. Los anónimos ven lo mismo sin foto (el mapa de la página de inicio).
--   4. map_open_demand(): para profesionales y personal: familias e instituciones con ofertas u horas abiertas, un pin por quien publica,
--      con su Trust Score y la cercanía. La familia sale del mapa si apaga «visible en el mapa» o cierra todo lo abierto.
--   5. map_institutions(): instituciones visibles con su estado.
--   6. get_live_counts(): contadores reales por rol —disponible, en vivo, ocupado— y servicios completados; get_platform_counts() pasa a
--      leer de ahí (ya no devuelve ceros).
--   7. Aviso en vivo: difusión privada «live_map_ping» (misma técnica que open_needs_ping) cuando cambia algo que ve el mapa; los clientes
--      recargan por las funciones seguras. La política de realtime.messages deja escuchar ese tema a cualquier cuenta con sesión.
--
-- Idempotente. Depende de 20261012190000 (hx_distance_km, hx_distance_band, hx_trust_calc, hx_pro_label).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 0) Ayudas ────────────────────────────────────────────────────────────────────

-- Aproxima una coordenada a una cuadrícula (por defecto 0,01° ≈ 1,1 km). Nunca se publica una posición más fina que esto.
CREATE OR REPLACE FUNCTION public.hx_cell(p double precision, p_size numeric DEFAULT 0.01)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN p IS NULL OR p_size IS NULL OR p_size <= 0 THEN NULL
              ELSE (round(p::numeric / p_size) * p_size)::double precision END
$fn$;

-- Cuánto tiempo cuenta una presencia sin nuevo latido. Una sola fuente de verdad para contadores y mapas.
CREATE OR REPLACE FUNCTION public.hx_presence_ttl()
RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$ SELECT interval '3 minutes' $fn$;

-- ── 1) Presencia ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_locations (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  user_type  text CHECK (user_type IN ('professional', 'family', 'institution')),
  lat        double precision,
  lng        double precision,
  is_online  boolean     NOT NULL DEFAULT true,
  last_seen  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Si la tabla venía de la versión antigua (GPS exacto, legible por cualquiera) se endurece: sin precisión, rumbo ni velocidad, sin
-- posiciones exactas guardadas y sin las políticas abiertas.
ALTER TABLE public.user_locations ADD COLUMN IF NOT EXISTS last_seen timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.user_locations ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE public.user_locations ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE public.user_locations DROP COLUMN IF EXISTS accuracy;
ALTER TABLE public.user_locations DROP COLUMN IF EXISTS heading;
ALTER TABLE public.user_locations DROP COLUMN IF EXISTS speed;
UPDATE public.user_locations
   SET lat = public.hx_cell(lat), lng = public.hx_cell(lng)
 WHERE (lat IS NOT NULL AND lat <> public.hx_cell(lat)) OR (lng IS NOT NULL AND lng <> public.hx_cell(lng));
-- Solo los profesionales que lo deciden publican posición; familias e instituciones no guardan ninguna.
UPDATE public.user_locations SET lat = NULL, lng = NULL
 WHERE user_type IS DISTINCT FROM 'professional' AND (lat IS NOT NULL OR lng IS NOT NULL);
-- Las filas antiguas no cuentan como «en vivo» por haber agregado la columna: su último latido es el de su última actualización.
UPDATE public.user_locations SET last_seen = updated_at WHERE last_seen > updated_at;

ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_online_locations ON public.user_locations;
DROP POLICY IF EXISTS own_location_write ON public.user_locations;
DROP POLICY IF EXISTS ul_select_self_or_staff ON public.user_locations;
CREATE POLICY ul_select_self_or_staff ON public.user_locations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- Nadie escribe directo: la presencia entra por touch_presence() / stop_presence().
REVOKE ALL ON public.user_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_locations TO authenticated;
GRANT ALL ON public.user_locations TO service_role;

CREATE INDEX IF NOT EXISTS user_locations_fresh_idx ON public.user_locations (user_type, last_seen DESC) WHERE is_online;

-- ── 2) Aviso en vivo ─────────────────────────────────────────────────────────────

-- Difusión privada sin datos: «algo que ve el mapa cambió». Si Realtime no está disponible no pasa nada.
CREATE OR REPLACE FUNCTION public.hx_ping_map()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  BEGIN
    PERFORM realtime.send('{}'::jsonb, 'map_changed', 'live_map_ping', true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$fn$;

CREATE OR REPLACE FUNCTION public.trg_ping_map()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  PERFORM public.hx_ping_map();
  RETURN NULL;
END
$fn$;

-- ── 3) Latido de presencia ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_presence(p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_type  text;
  v_lat   double precision;
  v_lng   double precision;
  v_old   record;
  v_had   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  -- El rol sale de la base, no de lo que diga el cliente. El personal y las cuentas sin perfil no cuentan como presencia.
  v_type := CASE WHEN public.has_role(v_uid, 'professional'::public.app_role) THEN 'professional'
                 WHEN public.has_role(v_uid, 'institution'::public.app_role)  THEN 'institution'
                 WHEN public.has_role(v_uid, 'family'::public.app_role)       THEN 'family' END;
  IF v_type IS NULL THEN
    RETURN;
  END IF;

  -- Solo un profesional que decide compartirla publica posición, siempre en la cuadrícula y dentro de Colombia y alrededores.
  IF v_type = 'professional' AND p_lat BETWEEN -5 AND 14 AND p_lng BETWEEN -82 AND -66 THEN
    v_lat := public.hx_cell(p_lat);
    v_lng := public.hx_cell(p_lng);
  END IF;

  SELECT ul.is_online, ul.last_seen, ul.lat, ul.lng INTO v_old FROM public.user_locations ul WHERE ul.user_id = v_uid;
  v_had := FOUND;

  -- Latido reciente y nada visible cambió: no se escribe (limita el tráfico).
  IF v_had AND v_old.is_online AND v_old.last_seen > now() - interval '20 seconds'
     AND v_old.lat IS NOT DISTINCT FROM v_lat AND v_old.lng IS NOT DISTINCT FROM v_lng THEN
    RETURN;
  END IF;

  INSERT INTO public.user_locations AS ul (user_id, user_type, lat, lng, is_online, last_seen, updated_at)
  VALUES (v_uid, v_type, v_lat, v_lng, true, now(), now())
  ON CONFLICT (user_id) DO UPDATE
     SET user_type = EXCLUDED.user_type, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         is_online = true, last_seen = now(), updated_at = now();

  -- Solo se avisa cuando cambia lo que ve el mapa: llegó, volvió después de un rato o se movió de cuadrícula.
  IF NOT v_had OR NOT v_old.is_online OR v_old.last_seen <= now() - public.hx_presence_ttl()
     OR v_old.lat IS DISTINCT FROM v_lat OR v_old.lng IS DISTINCT FROM v_lng THEN
    PERFORM public.hx_ping_map();
  END IF;

  -- Limpieza ocasional: la presencia de hace días no sirve para nada.
  IF random() < 0.02 THEN
    DELETE FROM public.user_locations WHERE last_seen < now() - interval '2 days';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION public.stop_presence()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_n   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  -- Al irse no queda ninguna posición guardada.
  UPDATE public.user_locations
     SET is_online = false, lat = NULL, lng = NULL, last_seen = now(), updated_at = now()
   WHERE user_id = v_uid AND (is_online OR lat IS NOT NULL OR lng IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.hx_ping_map();
  END IF;
END
$fn$;

-- ── 4) Contadores reales ─────────────────────────────────────────────────────────

-- Por rol: total (registrados), disponible, ocupado y en vivo.
--   Profesionales (publicados y activos, no bloqueados; «rethus» = con RETHUS verificado): disponible = marcado «disponible» y sin servicio ni reserva ahora;
--     ocupado = reservado o con un servicio en curso (o confirmado cuya hora está corriendo); en vivo = con la aplicación abierta
--     (latido en los últimos 3 minutos). Disponible y ocupado no se cruzan.
--   Familias e instituciones: disponible = con ofertas u horas abiertas (buscando cuidado o personal ahora); ocupado = con un servicio en
--     curso; en vivo = con la aplicación abierta. Una cuenta puede estar disponible y ocupada a la vez.
CREATE OR REPLACE FUNCTION public.get_live_counts()
RETURNS TABLE (
  pro_total bigint, pro_available bigint, pro_busy bigint, pro_live bigint, pro_rethus bigint,
  fam_total bigint, fam_available bigint, fam_busy bigint, fam_live bigint,
  inst_total bigint, inst_available bigint, inst_busy bigint, inst_live bigint,
  completed_services bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH
  running AS (
    SELECT b.professional_id AS pro_id, b.client_id
      FROM public.service_bookings b
     WHERE b.status = 'in_progress'
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  ),
  pros AS (
    SELECT pp.user_id,
           (COALESCE(pp.published, false) AND COALESCE(pp.active, true)) AS listed,
           COALESCE(pp.available, false) AS avail,
           COALESCE(pp.rethus_verified, false) AS rethus,
           (COALESCE(pp.reserved_until > now(), false)
            OR EXISTS (SELECT 1 FROM running r WHERE r.pro_id = pp.user_id)) AS busy
      FROM public.professional_profiles pp
     WHERE NOT COALESCE(pp.blocked, false)
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pp.user_id AND ur.role = 'professional'::public.app_role)
  ),
  live AS (
    SELECT ul.user_id, ul.user_type FROM public.user_locations ul
     WHERE ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl()
  ),
  fam_open AS (
    SELECT o.posted_by AS uid FROM public.job_offers o
     WHERE o.status = 'open' AND NOT COALESCE(o.blocked, false) AND o.poster_type::text = 'family'
    UNION
    SELECT n.family_user_id FROM public.family_needs n WHERE n.status = 'open' AND n.ends_at > now()
  ),
  inst_open AS (
    SELECT o.posted_by AS uid FROM public.job_offers o
     WHERE o.status = 'open' AND NOT COALESCE(o.blocked, false) AND o.poster_type::text = 'institution'
  ),
  fams  AS (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'family'::public.app_role),
  insts AS (SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'institution'::public.app_role)
  SELECT
    (SELECT count(*) FROM pros),
    (SELECT count(*) FROM pros p WHERE p.listed AND p.avail AND NOT p.busy),
    (SELECT count(*) FROM pros p WHERE p.listed AND p.busy),
    (SELECT count(*) FROM live l JOIN pros p ON p.user_id = l.user_id WHERE l.user_type = 'professional' AND p.listed),
    (SELECT count(*) FROM pros p WHERE p.listed AND p.rethus),
    (SELECT count(*) FROM fams),
    (SELECT count(*) FROM fams f WHERE f.user_id IN (SELECT uid FROM fam_open)),
    (SELECT count(*) FROM fams f WHERE f.user_id IN (SELECT client_id FROM running)),
    (SELECT count(*) FROM live l JOIN fams f ON f.user_id = l.user_id WHERE l.user_type = 'family'),
    (SELECT count(*) FROM insts),
    (SELECT count(*) FROM insts i WHERE i.user_id IN (SELECT uid FROM inst_open)),
    (SELECT count(*) FROM insts i WHERE i.user_id IN (SELECT client_id FROM running)),
    (SELECT count(*) FROM live l JOIN insts i ON i.user_id = l.user_id WHERE l.user_type = 'institution'),
    (SELECT count(*) FROM public.service_bookings b WHERE b.status = 'completed')
$fn$;

-- La función antigua (la usa el contador de la página de inicio) deja de devolver ceros en «en línea». Misma forma.
CREATE OR REPLACE FUNCTION public.get_platform_counts()
RETURNS TABLE (
  professionals_total bigint, professionals_available bigint, professionals_rethus bigint, professionals_online bigint,
  families_total bigint, families_online bigint, institutions_total bigint, institutions_online bigint, completed_services bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT c.pro_total, c.pro_available, c.pro_rethus, c.pro_live, c.fam_total, c.fam_live, c.inst_total, c.inst_live, c.completed_services
    FROM public.get_live_counts() c
$fn$;

-- ── 5) Pines por rol ─────────────────────────────────────────────────────────────

-- Profesionales publicados. Sin teléfono, sin dirección, nombre abreviado, posición en cuadrícula (la presencia compartida manda sobre
-- la sede). Los anónimos ven lo mismo sin foto.
CREATE OR REPLACE FUNCTION public.map_professionals(
  p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_radius_km double precision DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS TABLE (
  pro_id uuid, display_name text, avatar_url text, specialty text, sub_specialties text[], gender text, years_experience integer,
  hourly_rate integer, avg_rating numeric, trust_score integer, rethus_verified boolean, verified boolean, home_city text,
  lat double precision, lng double precision, status text, live boolean, last_seen timestamptz
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
     WHERE b.status = 'in_progress'
        OR (b.status = 'confirmed' AND now() >= b.scheduled_at
            AND now() < b.scheduled_at + COALESCE(b.duration_hours, 1) * interval '1 hour')
  ),
  base AS (
    SELECT pp.user_id AS pro_id,
           public.hx_pro_label(pr.full_name, true) AS display_name,
           CASE WHEN v_uid IS NULL THEN NULL ELSE COALESCE(pp.avatar_url, pr.avatar_url) END AS avatar_url,
           pp.specialty, pp.sub_specialties, pp.gender, pp.years_experience, pp.hourly_rate, pp.avg_rating, pp.trust_score,
           COALESCE(pp.rethus_verified, false) AS rethus_verified, COALESCE(pp.verified, false) AS verified, pp.home_city,
           COALESCE(CASE WHEN ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl() THEN ul.lat END, public.hx_cell(pp.lat)) AS lat,
           COALESCE(CASE WHEN ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl() THEN ul.lng END, public.hx_cell(pp.lng)) AS lng,
           CASE WHEN COALESCE(pp.reserved_until > now(), false) OR EXISTS (SELECT 1 FROM running r WHERE r.pro_id = pp.user_id) THEN 'busy'
                WHEN COALESCE(pp.available, false) THEN 'available'
                ELSE 'unavailable' END AS status,
           COALESCE(ul.is_online AND ul.last_seen > now() - public.hx_presence_ttl(), false) AS live,
           ul.last_seen
      FROM public.professional_profiles pp
      LEFT JOIN public.profiles pr ON pr.user_id = pp.user_id
      LEFT JOIN public.user_locations ul ON ul.user_id = pp.user_id
     WHERE COALESCE(pp.published, false) AND COALESCE(pp.active, true) AND NOT COALESCE(pp.blocked, false)
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pp.user_id AND ur.role = 'professional'::public.app_role)
  )
  SELECT b.pro_id, b.display_name, b.avatar_url, b.specialty, b.sub_specialties, b.gender, b.years_experience, b.hourly_rate, b.avg_rating,
         b.trust_score, b.rethus_verified, b.verified, b.home_city, b.lat, b.lng, b.status, b.live, b.last_seen
    FROM base b
   WHERE p_radius_km IS NULL OR p_lat IS NULL OR p_lng IS NULL
         OR public.hx_distance_km(p_lat, p_lng, b.lat, b.lng) <= p_radius_km
   ORDER BY b.live DESC, (b.status = 'available') DESC, (b.status = 'busy') DESC,
            public.hx_distance_km(p_lat, p_lng, b.lat, b.lng) NULLS LAST, b.avg_rating DESC NULLS LAST, b.pro_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END
$fn$;

-- Demanda abierta, un pin por quien publica (familia o institución), solo para profesionales y personal. La posición es la de la oferta
-- (ya aproximada por el disparador de privacidad) o, si no trae, la de quien publica, siempre en cuadrícula. Quien apaga «visible en el
-- mapa» no aparece (sus ofertas siguen en la lista de oportunidades). Sin nombre del paciente, teléfono ni dirección.
CREATE OR REPLACE FUNCTION public.map_open_demand(
  p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_radius_km double precision DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS TABLE (
  poster_id uuid, poster_kind text, display_name text, city text, lat double precision, lng double precision,
  open_offers integer, open_hours numeric, top_hourly integer, is_urgent boolean, offer_id uuid,
  trust_score integer, trust_level text, trust_enough boolean, distance_band integer
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
           a.open_offers, a.open_hours, a.top_hourly, a.urgent AS is_urgent, a.offer_id
      FROM agg a
      LEFT JOIN public.profiles pr ON pr.user_id = a.poster
      LEFT JOIN public.family_profiles fp ON fp.user_id = a.poster AND a.kind = 'family'
      LEFT JOIN public.institution_profiles ip ON ip.user_id = a.poster AND a.kind = 'institution'
     WHERE COALESCE(CASE WHEN a.kind = 'institution' THEN ip.visible_on_map ELSE fp.visible_on_map END, true)
  )
  SELECT x.poster_id, x.poster_kind, x.display_name, x.city, x.lat, x.lng, x.open_offers, x.open_hours, x.top_hourly, x.is_urgent, x.offer_id,
         t.score, t.level, t.enough_data,
         public.hx_distance_band(public.hx_distance_km(p_lat, p_lng, x.lat, x.lng))
    FROM pins x
    LEFT JOIN LATERAL public.hx_trust_calc(x.poster_id, x.poster_kind) t ON true
   WHERE p_radius_km IS NULL OR p_lat IS NULL OR p_lng IS NULL
         OR public.hx_distance_km(p_lat, p_lng, x.lat, x.lng) <= p_radius_km
   ORDER BY x.is_urgent DESC, public.hx_distance_km(p_lat, p_lng, x.lat, x.lng) NULLS LAST, x.top_hourly DESC NULLS LAST, x.poster_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500);
END
$fn$;

-- Instituciones visibles. Son organizaciones, no personas: nombre y tipo públicos, posición en cuadrícula de ~0,5 km.
CREATE OR REPLACE FUNCTION public.map_institutions(p_limit integer DEFAULT 300)
RETURNS TABLE (
  inst_id uuid, name text, institution_type text, city text, lat double precision, lng double precision,
  verified boolean, status text, live boolean, open_offers integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH running AS (
    SELECT DISTINCT b.client_id AS uid
      FROM public.service_bookings b
     WHERE b.status = 'in_progress'
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
         COALESCE(op.n, 0)
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

-- ── 6) Disparadores del aviso, política de Realtime y permisos ───────────────────

DO $hx_map$
DECLARE
  spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['professional_profiles', 'AFTER INSERT OR DELETE OR UPDATE OF available, published, active, blocked, reserved_until, lat, lng, specialty, hourly_rate'],
    ['family_profiles',       'AFTER INSERT OR DELETE OR UPDATE OF visible_on_map, default_lat, default_lng'],
    ['institution_profiles',  'AFTER INSERT OR DELETE OR UPDATE OF visible_on_map, lat, lng, institution_name'],
    ['job_offers',            'AFTER INSERT OR DELETE OR UPDATE OF status, blocked, lat, lng'],
    ['family_needs',          'AFTER INSERT OR DELETE OR UPDATE OF status'],
    ['service_bookings',      'AFTER INSERT OR UPDATE OF status'],
    ['user_roles',            'AFTER INSERT OR DELETE']
  ]
  LOOP
    IF to_regclass('public.' || spec[1]) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_map_ping ON public.%I', spec[1]);
      EXECUTE format('CREATE TRIGGER trg_map_ping %s ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.trg_ping_map()', spec[2], spec[1]);
    END IF;
  END LOOP;

  -- Cualquier cuenta con sesión puede escuchar el aviso (no lleva datos). Las anónimas no.
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS live_map_ping_for_authenticated ON realtime.messages';
    EXECUTE $p$CREATE POLICY live_map_ping_for_authenticated ON realtime.messages
                FOR SELECT TO authenticated USING (realtime.topic() = 'live_map_ping')$p$;
  END IF;
END
$hx_map$;

REVOKE ALL ON FUNCTION public.hx_cell(double precision, numeric)                                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_presence_ttl()                                                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_ping_map()                                                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_ping_map()                                                                   FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.touch_presence(double precision, double precision)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stop_presence()                                                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.map_open_demand(double precision, double precision, double precision, integer)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(double precision, double precision)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_presence()                                                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.map_open_demand(double precision, double precision, double precision, integer) TO authenticated;

-- Lo público (contadores y mapa de la página de inicio): sin datos personales.
REVOKE ALL ON FUNCTION public.get_live_counts()                                                                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_counts()                                                            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.map_professionals(double precision, double precision, double precision, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.map_institutions(integer)                                                        FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_live_counts()                                                             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_counts()                                                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.map_professionals(double precision, double precision, double precision, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.map_institutions(integer)                                                     TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
